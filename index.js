const fs = require('fs/promises');
const path = require('path');
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
async function directoryReaders(dir) {
  const files = await fs.readdir(path.join(options.src, dir));
  return files.map(file => new FileReader(path.join(dir, file)));
}

/**
 * The main piping logic.
 */
async function main() {
  const logger = new Logger();
  const writer = new FileWriter();

  const readers = [];

  // Handle static files.
  const staticReaders = await directoryReaders('static')
  staticReaders.map(reader => reader.pipe(writer));
  readers.push(...staticReaders);

  // Handle image files.
  const imageReaders = await directoryReaders('images')
  imageReaders.map(reader => reader.pipe(writer));
  readers.push(...imageReaders);

  // Execute all.
  readers.map(reader => reader.execute());
}

main();
