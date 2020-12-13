const fs = require('fs/promises');
const markdown = require('showdown');
const path = require('path');
const pug = require('pug');
const {fail} = require('assert');

// The singleton markdown converter.
const markdownConverter = new markdown.Converter({
  ghCompatibleHeaderId: true,
  simplifiedAutoLink: true,
  tables: true,
  openLinksInNewWindow: true,
});

/**
 * The parseArgv() function will parse the argv options, `--key value` or
 * `--key=value`, into a JS object with the key/value entries.
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

// The options mainly include the `src` directory and the `out` directory.
const options = parseArgv(process.argv);

/**
 * FileData is the main object used as an input/output of the following pipes.
 */
class FileData {
  constructor(relpath) {
    this.dirname = path.dirname(relpath);
    this.extname = path.extname(relpath);
    this.basename = path.basename(relpath, this.extname);
    this.content = null;
    this.metadata = {};
  }

  dir(root='') {
    return path.join(root, this.dirname);
  }

  path(root='') {
    return path.join(this.dir(root), this.basename + this.extname);
  }
}

/**
 * Definition of Pipe, the base clase of every pipe implementation.
 */
class Pipe {
  constructor() {
    this.nextPipes = [];
  }

  // The operate() method is called when a previous pipe's output is passed.
  //
  // This method should be overriden properly in the implementation classes.
  //
  // If it returns a truthy value, the value will be passed to the next pipes.
  // Otherwise, the flow stops in the current pipe.
  operate(input) {
    fail("This method should be overriden in the implementation classes.");
    return null;
  }

  pipe(nextPipe) {
    if (!this.nextPipes.includes(nextPipe))
      this.nextPipes.push(nextPipe);
    // Return nextPipe for chaining, e.g. x.pipe(y).pipe(z)
    return nextPipe;
  }

  async execute(input) {
    // `await` can handle non-Promise values too, so operate() can return
    // either a promise or a plain value.
    const output = await this.operate(input);
    if (output)
      this.nextPipes.map(next => next.execute(output));
  }
}

/**
 * FileReader is to read a file and produce a FileData object.
 *
 * As it's a source pipe, it doesn't accept any input. Instead, it should be
 * triggered manually by calling execute(), or the static executeAll() helper
 * function.
 */
class FileReader extends Pipe {
  constructor(path) {
    super();
    this.file = new FileData(path);

    FileReader._instances.push(this);
  }

  async operate() {
    this.file.content = await fs.readFile(this.file.path(options.src));
    return this.file;
  }

  static executeAll() {
    FileReader._instances.map(reader => reader.execute());
  }
}

// A static variable to keep all FileReader instances.
FileReader._instances = [];

// A helper method to return file readers for all files in a given directory.
async function fileReadersInDir(dir) {
  const files = await fs.readdir(path.join(options.src, dir));
  return files.map(file => new FileReader(path.join(dir, file)));
}

/**
 * FileWriter is to write a file from a FileData object.
 *
 * As it's a sync pipe, it doesn't produce any output.
 */
class FileWriter extends Pipe {
  async operate(file) {
    await fs.mkdir(file.dir(options.out), {recursive: true});
    await fs.writeFile(file.path(options.out), file.content);
  }
}

/**
 * PostParser is a pipe to accept a post file (in Markdown) and produce an HTML
 * output with the post's metadata.
 */
const metadataRegex = /^- *(.+): *(.+)$/;
const titleRegex = /^# *(.+)$/;
class PostParser extends Pipe {
  async operate(file) {
    const lines = file.content.toString('utf8').split('\n');

    // In each post file, metadata is represented as an unordered list with a
    // colon (:) as the key-value separator and a comma (,) as the value
    // separator.
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
    // Parsing metadata ends at the post's title, starting with a sharp (#).
    const metadata = {};
    while (lines.length) {
      const line = lines.shift();
      if (line == '') continue;  // Ignore any empty line.

      let m;
      if (m = metadataRegex.exec(line)) {
        metadata[m[1]] = m[2].split(',').map(str => str.trim());
      } else if (m = titleRegex.exec(line)) {
        metadata.title = m[1];
        break;
      } else {
        fail('The post is malformed.');
      }
    }
    file.metadata = metadata;

    // Convert the markdown content into HTML.
    const markdownContent = lines.join('\n');
    file.content = markdownConverter.makeHtml(markdownContent);
    file.extname = '.html';

    return file;
  }
}

/**
 * PugCompiler is to compile a Pug template into an HTML file.
 *
 * It uses 2 inputs; one is a template file and the other is a date file. Each
 * data file will produce an output.
 */
class PugCompiler extends Pipe {
  constructor() {
    super();

    // The template is provided as a promise object, so that when a data file
    // is fed before the template file, it can wait for the future template.
    this.promisedTemplate = new Promise(resolve => {
      this.resolveTemplate = resolve;
    });
  }

  async operate(input) {
    if (input instanceof FileData && input.extname == '.pug') {
      // If it's the template file, resolve it to the promise.
      this.resolveTemplate(pug.compile(input.content));
      // The template itself doesn't produce an output.
    } else {
      // If it's a data file, wait for the template and render the content.
      const template = await this.promisedTemplate;
      input.content = template(input);
      return input;  // Each data file produces an output.
    }
  }
}

/**
 * Aggregator is to aggregate inputs and produce the aggregated output.
 *
 * It's useful when information from multiple files is needed to render a
 * single output.
 *
 * The output produced by an aggregator is an empty file, with the aggregated
 * inputs in its `metadata.inputs` property.
 */
class Aggregator extends Pipe {
  constructor(path, aggregationCount, compareFunction=undefined) {
    super();
    this.file = new FileData(path);
    // aggregationCount represents the count of inputs to be aggregated per
    // output.
    this.aggregationCount = aggregationCount;
    // compareFunction is used to sort the aggregated inputs.
    this.compareFunction = compareFunction;
    this.inputs = [];
  }

  operate(input) {
    this.inputs.push(input);
    if (this.inputs.length == this.aggregationCount) {
      this.inputs.sort(this.compareFunction);
      this.file.metadata.inputs = this.inputs;
      this.inputs = [];  // Empty the aggregated inputs.
      return this.file;
    }
  }
}

/**
 * The main function.
 *
 * All pipe instances are initialized and piped in this method.
 *
 * The entire pipeline:
 *
 *   [FileReader statics/*]────────────────────────────────────────┐
 *                                                                 │
 *   [FileReader images/*]─────────────────────────────────────────┤
 *                                                                 │
 *   [FileReader template/post.pug]───────────────┐                │
 *                                                │                │
 *   [FileReader posts/*]──┬────────────────[PugCompiler]──────────┤
 *                         │                                       │
 *                         └─────[Aggregator]─────┐                │
 *                                                │                │
 *   [FileReader template/index.pug]─────────[PugCompiler]─────────┤
 *                                                                 │
 *                                                            [FileWriter]
 */
async function main() {
  // The singleton file writer.
  const writer = new FileWriter();

  // File readers for static files.
  const staticReaders = await fileReadersInDir('static')
  staticReaders.map(reader => reader.pipe(writer));  // Just copy.

  // File readers for image files.
  const imageReaders = await fileReadersInDir('images')
  imageReaders.map(reader => reader.pipe(writer));  // Just copy.

  // Prepare the post page compiler with the template file.
  const postCompiler = new PugCompiler();
  new FileReader('templates/post.pug').pipe(postCompiler);

  // Prepare the index page compiler with the template file.
  const indexCompiler = new PugCompiler();
  new FileReader('templates/index.pug').pipe(indexCompiler);

  // File readers for post files.
  const postReaders = await fileReadersInDir('posts');

  // Render each post page using the post page compiler.
  const postParser = new PostParser();
  postReaders.map(reader =>
    reader.pipe(postParser).pipe(postCompiler).pipe(writer));

  // Render the index page using the index page compiler.
  // An aggregator pipe is used to aggregate all post files, to render the post
  // list in the index page.
  const postAggregator = new Aggregator(
    'index.html',
    postReaders.length,  // Aggregates all post files.
    // Sorted in the descending order of the posted date.
    (x, y) => -x.metadata.date[0].localeCompare(y.metadata.date[0]),
  );
  postReaders.map(reader =>
    reader.pipe(postAggregator).pipe(indexCompiler).pipe(writer));

  // Execute all.
  FileReader.executeAll();
}

main();
