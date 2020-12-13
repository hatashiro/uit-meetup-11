const fs = require('fs/promises');
const markdown = require('showdown');
const path = require('path');
const pug = require('pug');
const {fail} = require('assert');

/**
 * Parse argv.
 */
const optionRegex = /^--?(.+?)(=(.*))?$/;
function parseArgv(argv) {
  const [node, script, ...opts] = argv;
  const options = {};
  for (let i = 0; i < opts.length; i++) {
    const m = optionRegex.exec(opts[i]);
    if (!m) continue;
    const key = m[1];
    const value = m[3] || opts[++i] || '';
    options[key] = value;
  }
  return options;
}
const options = parseArgv(process.argv);

/**
 * Definition of FileData.
 */
class FileData {
  constructor(relpath) {
    this.rootdir = '';
    this.dirname = path.dirname(relpath);
    this.extname = path.extname(relpath);
    this.basename = path.basename(relpath, this.extname);
    this.content = null;
    this.metadata = {};
  }

  get dir() {
    return path.join(this.rootdir, this.dirname);
  }

  get path() {
    return path.join(this.dir, this.basename + this.extname);
  }
}

/**
 * Definition of Pipe.
 */
class Pipe {
  constructor() {
    this.nextPipes = [];
  }

  operate(input) {
    fail("This method should be overriden in the implementation classes.");
    // Note that the output will be fed to the next pipes, unless it's falsy.
    return null;
  }

  pipe(nextPipe) {
    if (!this.nextPipes.includes(nextPipe))
      this.nextPipes.push(nextPipe);
    // Return nextPipe for chaining, e.g. x.pipe(y).pipe(z)
    return nextPipe;
  }

  async execute(input) {
    // `await` can handle non-Promise values too, so pipeFunction can become
    // either an async or plain function.
    const output = await this.operate(input);
    if (output) this.nextPipes.map(next => next.execute(output));
  }
}

// A logger pipe that just bypasses the value with console-logging it.
class Logger extends Pipe {
  operate(file) {
    console.log(file.path);
    console.log('---');
    console.log(file.content.toString('utf8').trim());
    console.log('---');
    console.log(file.metadata);
    return file;
  }
}

/**
 * Source and output.
 */
class FileReader extends Pipe {
  constructor(path) {
    super();
    this.file = new FileData(path);
    this.file.rootdir = options.src;
  }

  async operate() {
    this.file.content = await fs.readFile(this.file.path);
    return this.file;
  }
}

class FileWriter extends Pipe {
  async operate(file) {
    file.rootdir = options.out;
    await fs.mkdir(file.dir, {recursive: true});
    await fs.writeFile(file.path, file.content);
  }
}

// Returns file readers of files in a given directory.
async function fileReadersInDir(dir) {
  const files = await fs.readdir(path.join(options.src, dir));
  return files.map(file => new FileReader(path.join(dir, file)));
}

/**
 * Post parser.
 */
const metadataRegex = /^- *(.+): *(.+)$/;
const titleRegex = /^# *(.+)$/;

const markdownConverter = new markdown.Converter({
  ghCompatibleHeaderId: true,
  simplifiedAutoLink: true,
  tables: true,
  openLinksInNewWindow: true,
});

class PostParser extends Pipe {
  async operate(file) {
    const lines = file.content.toString('utf8').split('\n');

    // Parse metadata.
    //
    // Post metadata is represented as an unordered list with a colon (:) as
    // the key-value separator and a comma (,) as the value separator.
    //
    // For example, the following metadata in a post ...
    //
    //   - date: 2020-12-10
    //   - tags: Brave, News Reader, Browser
    //
    // ... will be parsed as the following JS object.
    //
    //   {
    //     date: ['2020-12-10'],
    //     tags: ['Brave', 'News Reader', 'Browser'],
    //   }
    //
    // Parsing metadata will (and must) finish with a H1 title, starting with
    // a sharp (#).
    const metadata = {};
    let markdownContent = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Ignore any empty line.
      if (line == '') continue;

      let m;
      if (m = metadataRegex.exec(line)) {
        metadata[m[1]] = m[2].split(',').map(str => str.trim());
      } else if (m = titleRegex.exec(line)) {
        metadata.title = m[1];
        markdownContent = lines.slice(i).join('\n');
        break;
      } else {
        fail('The post is malformed.');
      }
    }
    file.metadata = metadata;

    // Convert the markdown content into HTML.
    file.content = markdownConverter.makeHtml(markdownContent);
    file.extname = '.html';

    return file;
  }
}

/**
 * Template compiler.
 */
class PugCompiler extends Pipe {
  constructor() {
    super();
    this.template = null;
  }

  // The PugCompiler pipe needs 2 inputs, one for the Pug template file and the
  // other for the input data. The template should be fed first to process
  // an input. Otherwise, the input will be ignored.
  operate(input) {
    if (input instanceof FileData && input.extname == '.pug') {
      this.template = pug.compile(input.content);
    } else if (this.template) {
      input.content = this.template(input);
      return input;
    }
  }
}

/**
 * The main piping logic.
 */
async function main() {
  const logger = new Logger();
  const writer = new FileWriter();

  // Handle static files.
  const staticReaders = await fileReadersInDir('static')
  staticReaders.map(reader => reader.pipe(writer));

  // Handle image files.
  const imageReaders = await fileReadersInDir('images')
  imageReaders.map(reader => reader.pipe(writer));

  // Prepare the post compiler.
  const postTemplateReader = new FileReader('templates/post.pug');
  const postCompiler = new PugCompiler();
  postTemplateReader.pipe(postCompiler);
  postTemplateReader.execute();  // Feed the post compiler with the template.

  const postReaders = await fileReadersInDir('posts');
  const postParser = new PostParser();
  postReaders
    .map(reader => reader.pipe(postParser).pipe(postCompiler).pipe(writer));

  // Execute all.
  [].concat(staticReaders)
    .concat(imageReaders)
    .concat(postReaders)
    .map(reader => reader.execute());
}

main();
