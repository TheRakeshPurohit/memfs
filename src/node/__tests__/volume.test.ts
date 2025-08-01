import { promisify } from 'util';
import { URL } from 'url';
import { Link } from '../../core';
import Stats from '../Stats';
import Dirent from '../Dirent';
import { Volume, StatWatcher } from '../volume';
import hasBigInt from '../../__tests__/hasBigInt';
import { tryGetChild, tryGetChildNode } from '../../__tests__/util';
import { genRndStr6 } from '../util';
import queueMicrotask from '../../queueMicrotask';
import { constants } from '../../constants';
import { filenameToSteps } from '../../core/util';

const { O_RDWR, O_SYMLINK } = constants;

describe('volume', () => {
  describe('filenameToSteps(filename): string[]', () => {
    it('/ -> []', () => {
      expect(filenameToSteps('/')).toEqual([]);
    });
    it('/test -> ["test"]', () => {
      expect(filenameToSteps('/test')).toEqual(['test']);
    });
    it('/usr/bin/node.sh -> ["usr", "bin", "node.sh"]', () => {
      expect(filenameToSteps('/usr/bin/node.sh')).toEqual(['usr', 'bin', 'node.sh']);
    });
    it('/dir/file.txt -> ["dir", "file.txt"]', () => {
      expect(filenameToSteps('/dir/file.txt')).toEqual(['dir', 'file.txt']);
    });
    it('/dir/./file.txt -> ["dir", "file.txt"]', () => {
      expect(filenameToSteps('/dir/./file.txt')).toEqual(['dir', 'file.txt']);
    });
    it('/dir/../file.txt -> ["file.txt"]', () => {
      expect(filenameToSteps('/dir/../file.txt')).toEqual(['file.txt']);
    });
  });
  it('genRndStr6()', () => {
    for (let i = 0; i < 100; i++) {
      const str = genRndStr6();
      expect(typeof str === 'string').toBe(true);
      expect(str.length).toBe(6);
    }
  });
  describe('Volume', () => {
    describe('.getLink(steps)', () => {
      const vol = new Volume();
      it('[] - Get the root link', () => {
        const link = vol._core.getLink([]);
        expect(link).toBeInstanceOf(Link);
        expect(link).toBe(vol._core.root);
      });
      it('["child.sh"] - Get a child link', () => {
        const link1 = vol._core.root.createChild('child.sh');
        const link2 = vol._core.getLink(['child.sh']);
        expect(link1).toBe(link2);
      });
      it('["dir", "child.sh"] - Get a child link in a dir', () => {
        const dir = vol._core.root.createChild('dir');
        const link1 = dir.createChild('child.sh');
        const node2 = vol._core.getLink(['dir', 'child.sh']);
        expect(link1).toBe(node2);
      });
    });
    describe('i-nodes', () => {
      it('i-node numbers are unique', () => {
        const vol = Volume.fromJSON({
          '/1': 'foo',
          '/2': 'bar',
        });
        const stat1 = vol.statSync('/1');
        const stat2 = vol.statSync('/2');
        expect(stat1.ino === stat2.ino).toBe(false);
      });
    });

    describe('.toJSON()', () => {
      it('Single file', () => {
        const vol = new Volume();
        vol.writeFileSync('/test', 'Hello');
        expect(vol.toJSON()).toEqual({ '/test': 'Hello' });
      });

      it('Multiple files', () => {
        const vol = new Volume();
        vol.writeFileSync('/test', 'Hello');
        vol.writeFileSync('/test2', 'Hello2');
        vol.writeFileSync('/test.txt', 'Hello3');
        expect(vol.toJSON()).toEqual({
          '/test': 'Hello',
          '/test2': 'Hello2',
          '/test.txt': 'Hello3',
        });
      });

      it('With folders, skips empty folders', () => {
        const vol = new Volume();
        vol.writeFileSync('/test', 'Hello');
        vol.mkdirSync('/dir');
        vol.mkdirSync('/dir/dir2');

        // Folder `/dir3` will be empty, and should not be in the JSON aoutput.
        vol.mkdirSync('/dir3');

        vol.writeFileSync('/dir/abc', 'abc');
        vol.writeFileSync('/dir/abc2', 'abc2');
        vol.writeFileSync('/dir/dir2/hello.txt', 'world');
        expect(vol.toJSON()).toEqual({
          '/test': 'Hello',
          '/dir/abc': 'abc',
          '/dir/abc2': 'abc2',
          '/dir/dir2/hello.txt': 'world',
          '/dir3': null,
        });
      });

      it('Specify export path', () => {
        const vol = Volume.fromJSON({
          '/foo': 'bar',
          '/dir/a': 'b',
        });
        expect(vol.toJSON('/dir')).toEqual({
          '/dir/a': 'b',
        });
      });

      it('Specify multiple export paths', () => {
        const vol = Volume.fromJSON({
          '/foo': 'bar',
          '/dir/a': 'b',
          '/dir2/a': 'b',
          '/dir2/c': 'd',
        });
        expect(vol.toJSON(['/dir2', '/dir'])).toEqual({
          '/dir/a': 'b',
          '/dir2/a': 'b',
          '/dir2/c': 'd',
        });
      });

      it('Specify a file export path', () => {
        const vol = Volume.fromJSON({
          '/foo': 'bar',
          '/dir/a': 'b',
          '/dir2/a': 'b',
          '/dir2/c': 'd',
        });
        expect(vol.toJSON(['/dir/a'])).toEqual({
          '/dir/a': 'b',
        });
      });

      it('Accumulate exports on supplied object', () => {
        const vol = Volume.fromJSON({
          '/foo': 'bar',
        });
        const obj = {};
        expect(vol.toJSON('/', obj)).toBe(obj);
      });

      it('Export empty volume', () => {
        const vol = Volume.fromJSON({});
        expect(vol.toJSON()).toEqual({});
      });

      it('Exporting non-existing path', () => {
        const vol = Volume.fromJSON({});
        expect(vol.toJSON('/lol')).toEqual({});
      });

      it('Serializes empty dirs as null', () => {
        const vol = Volume.fromJSON({
          '/dir': null,
        });

        expect(vol.toJSON()).toEqual({
          '/dir': null,
        });
      });

      it('Serializes only empty dirs', () => {
        const vol = Volume.fromJSON({
          '/dir': null,
          '/dir/dir2': null,
          '/dir/dir2/foo': null,
          '/empty': null,
        });

        expect(vol.toJSON()).toEqual({
          '/dir/dir2/foo': null,
          '/empty': null,
        });
      });

      it('Outputs files as buffers if the option is set', () => {
        const buffer = Buffer.from('Hello');
        const vol = new Volume();
        vol.writeFileSync('/file', buffer);
        const result = vol.toJSON('/', {}, false, true)['/file'];
        expect(result).toStrictEqual(buffer);
      });

      it('Outputs files in subdirectories as buffers too', () => {
        const buffer = Buffer.from('Hello');
        const vol = new Volume();
        vol.mkdirSync('/dir');
        vol.writeFileSync('/dir/file', buffer);
        const result = vol.toJSON('/', {}, false, true)['/dir/file'];
        expect(result).toStrictEqual(buffer);
      });
    });

    describe('.fromJSON(json[, cwd])', () => {
      it('Files at root', () => {
        const vol = new Volume();
        const json = {
          '/hello': 'world',
          '/app.js': 'console.log(123)',
        };
        vol.fromJSON(json);
        expect(vol.toJSON()).toEqual(json);
      });

      it('Files and directories at root with relative paths', () => {
        const vol = new Volume();
        const json = {
          hello: 'world',
          'app.js': 'console.log(123)',
          dir: null,
        };
        vol.fromJSON(json, '/');
        expect(vol.toJSON()).toEqual({
          '/hello': 'world',
          '/app.js': 'console.log(123)',
          '/dir': null,
        });
      });

      it('Deeply nested tree', () => {
        const vol = new Volume();
        const json = {
          '/dir/file': '...',
          '/dir/dir/dir2/hello.sh': 'world',
          '/hello.js': 'console.log(123)',
          '/dir/dir/test.txt': 'Windows',
        };
        vol.fromJSON(json);
        expect(vol.toJSON()).toEqual(json);
      });

      it('Invalid JSON throws error', () => {
        try {
          const vol = new Volume();
          const json = {
            '/dir/file': '...',
            '/dir': 'world',
          };
          vol.fromJSON(json);
          throw Error('This should not throw');
        } catch (error) {
          // Check for both errors, because in JavaScript we the `json` map's key order is not guaranteed.
          expect(error.code === 'EISDIR' || error.code === 'ENOTDIR').toBe(true);
        }
      });

      it('Invalid JSON throws error 2', () => {
        try {
          const vol = new Volume();
          const json = {
            '/dir': 'world',
            '/dir/file': '...',
          };
          vol.fromJSON(json);
          throw Error('This should not throw');
        } catch (error) {
          // Check for both errors, because in JavaScript we the `json` map's key order is not guaranteed.
          expect(error.code === 'EISDIR' || error.code === 'ENOTDIR').toBe(true);
        }
      });

      it('creates a folder if value is not a string', () => {
        const vol = Volume.fromJSON({
          '/dir': null,
        });
        const stat = vol.statSync('/dir');

        expect(stat.isDirectory()).toBe(true);
        expect(vol.readdirSync('/dir')).toEqual([]);
      });

      it('supports using buffers for file content', () => {
        const vol = new Volume();
        const text = 'bip-boup';
        const buffer = Buffer.from(text, 'utf-8');
        vol.fromJSON({ '/buffer': buffer });
        expect(vol.toJSON()).toStrictEqual({ '/buffer': text });
        expect(vol.readFileSync('/buffer')).toStrictEqual(buffer);
        expect(vol.readFileSync('/buffer', 'utf-8')).toStrictEqual(text);
      });
    });

    describe('.fromNestedJSON(nestedJSON[, cwd])', () => {
      it('Accept a nested dict as input because its nicer to read', () => {
        const vol1 = new Volume();
        const vol2 = new Volume();

        const jsonFlat = {
          '/dir/file': '...',
          '/emptyDir': null,
          '/anotherEmptyDir': null,
          '/oneMoreEmptyDir': null,
          '/dir/dir/dir2/hello.sh': 'world',
          '/hello.js': 'console.log(123)',
          '/dir/dir/test.txt': 'File with leading slash',
        };
        const jsonNested = {
          '/dir/': {
            file: '...',
            dir: {
              dir2: {
                'hello.sh': 'world',
              },
              '/test.txt': 'File with leading slash',
            },
          },
          '/emptyDir': {},
          '/anotherEmptyDir': null,
          '/oneMoreEmptyDir': {
            '': null, // this could be considered a glitch, but "" is not a valid filename anyway
            // (same as 'file/name' is invalid and would lead to problems)
          },
          '/hello.js': 'console.log(123)',
        };

        vol1.fromJSON(jsonFlat);
        vol2.fromNestedJSON(jsonNested);

        expect(vol1.toJSON()).toEqual(vol2.toJSON());
      });
    });

    describe('.reset()', () => {
      it('remove all files', () => {
        const vol = new Volume();
        const json = {
          '/hello': 'world',
          '/app.js': 'console.log(123)',
        };
        vol.fromJSON(json);
        vol.reset();
        expect(vol.toJSON()).toEqual({});
      });

      it('file operations should work after reset', () => {
        const vol = new Volume();
        const json = {
          '/hello': 'world',
        };
        vol.fromJSON(json);
        vol.reset();
        vol.writeFileSync('/good', 'bye');
        expect(vol.toJSON()).toEqual({
          '/good': 'bye',
        });
      });

      it('open streams should error', async () => {
        const vol = new Volume();
        const json = {
          '/hello': 'world',
        };
        vol.fromJSON(json);
        expect(
          new Promise((resolve, reject) => {
            vol
              .createReadStream('/hello')
              .on('data', () => null)
              .on('close', resolve)
              .on('end', () => {
                vol.reset();
              })
              .on('error', reject);
          }),
        ).rejects.toThrow();
      });
    });
    describe('.openSync(path, flags[, mode])', () => {
      const vol = new Volume();
      it('Create new file at root (/test.txt)', () => {
        const oldMtime = vol._core.root.getNode().mtime;
        const fd = vol.openSync('/test.txt', 'w');
        const newMtime = vol._core.root.getNode().mtime;
        expect(vol._core.root.getChild('test.txt')).toBeInstanceOf(Link);
        expect(typeof fd).toBe('number');
        expect(fd).toBeGreaterThan(0);
        expect(oldMtime).not.toBe(newMtime);
      });
      it('Create new file with Uint8Array path', () => {
        const path = new TextEncoder().encode('/test.txt');
        const fd = vol.openSync(path, 'w');
        expect(typeof fd).toBe('number');
        expect(fd).toBeGreaterThan(0);
      });
      it('Error on file not found', () => {
        try {
          vol.openSync('/non-existing-file.txt', 'r');
          throw Error('This should not throw');
        } catch (err) {
          expect(err.code).toBe('ENOENT');
        }
      });
      it('Invalid path correct error code', () => {
        try {
          (vol as any).openSync(123, 'r');
          throw Error('This should not throw');
        } catch (err) {
          expect(err).toBeInstanceOf(TypeError);
          expect(err.message).toBe('path must be a string, Buffer, or Uint8Array');
        }
      });
      it('Invalid flags correct error code', () => {
        try {
          (vol as any).openSync('/non-existing-file.txt');
          throw Error('This should not throw');
        } catch (err) {
          expect(err.code).toBe('ERR_INVALID_OPT_VALUE');
        }
      });
      it('Invalid mode correct error code', () => {
        try {
          vol.openSync('/non-existing-file.txt', 'r', 'adfasdf');
          throw Error('This should not throw');
        } catch (err) {
          expect(err).toBeInstanceOf(TypeError);
          expect(err.message).toBe('mode must be an int');
        }
      });
      it('Open multiple files', () => {
        const fd1 = vol.openSync('/1.json', 'w');
        const fd2 = vol.openSync('/2.json', 'w');
        const fd3 = vol.openSync('/3.json', 'w');
        const fd4 = vol.openSync('/4.json', 'w');
        expect(typeof fd1).toBe('number');
        expect(fd1 !== fd2).toBe(true);
        expect(fd2 !== fd3).toBe(true);
        expect(fd3 !== fd4).toBe(true);
      });
    });
    describe('.open(path, flags[, mode], callback)', () => {
      const vol = new Volume();
      vol.mkdirSync('/test-dir');
      it('Create new file at root (/test.txt)', done => {
        vol.open('/test.txt', 'w', (err, fd) => {
          expect(err).toBe(null);
          expect(vol._core.root.getChild('test.txt')).toBeInstanceOf(Link);
          expect(typeof fd).toBe('number');
          expect(fd).toBeGreaterThan(0);
          done();
        });
      });
      it('Creates a character device at root (/null)', done => {
        vol.open('/null', 'w', constants.S_IFCHR | 0o666, (err, fd) => {
          expect(err).toBe(null);
          expect(vol._core.root.getChild('null')?.getNode().isCharacterDevice()).toBe(true);
          expect(typeof fd).toBe('number');
          expect(fd).toBeGreaterThan(0);
          done();
        });
      }, 100);
      it('Error on file not found', done => {
        vol.open('/non-existing-file.txt', 'r', (err, fd) => {
          expect(err).toHaveProperty('code', 'ENOENT');
          done();
        });
      });
      it('Error with exclude flag if file exists', done => {
        vol.writeFileSync('/existing-file.txt', 'foo');
        vol.open('/existing-file.txt', 'wx', err => {
          expect(err).toHaveProperty('code', 'EEXIST');
          done();
        });
      });
      it('Invalid path correct error code thrown synchronously', done => {
        try {
          (vol as any).open(123, 'r', (err, fd) => {
            throw Error('This should not throw');
          });
          throw Error('This should not throw');
        } catch (err) {
          expect(err).toBeInstanceOf(TypeError);
          expect(err.message).toBe('path must be a string, Buffer, or Uint8Array');
          done();
        }
      });
      it('Invalid flags correct error code thrown synchronously', done => {
        try {
          (vol as any).open('/non-existing-file.txt', undefined, () => {
            throw Error('This should not throw');
          });
          throw Error('This should not throw');
        } catch (err) {
          expect(err.code).toBe('ERR_INVALID_OPT_VALUE');
          done();
        }
      });
      it('Invalid mode correct error code thrown synchronously', done => {
        try {
          (vol as any).openSync('/non-existing-file.txt', 'r', 'adfasdf', () => {
            throw Error('This should not throw');
          });
          throw Error('This should not throw');
        } catch (err) {
          expect(err).toBeInstanceOf(TypeError);
          expect(err.message).toBe('mode must be an int');
          done();
        }
      });
      it('Properly sets permissions from mode when creating a new file', done => {
        vol.writeFileSync('/a.txt', 'foo');
        const stats = vol.statSync('/a.txt');
        // Write a new file, copying the mode from the old file
        vol.open('/b.txt', 'w', stats.mode, (err, fd) => {
          expect(err).toBe(null);
          expect(vol._core.root.getChild('b.txt')).toBeInstanceOf(Link);
          expect(typeof fd).toBe('number');
          expect(tryGetChildNode(vol._core.root, 'b.txt').canWrite()).toBe(true);
          done();
        });
      });
      it('Error on incorrect flags for directory', done => {
        vol.open('/test-dir', 'r+', (err, fd) => {
          expect(err).toHaveProperty('code', 'EISDIR');
          done();
        });
      });
      it('Properly opens directory as read-only', done => {
        vol.open('/test-dir', 'r', (err, fd) => {
          expect(err).toBe(null);
          expect(typeof fd).toBe('number');
          done();
        });
      });
    });
    describe('.close(fd, callback)', () => {
      const vol = new Volume();
      it('Closes file without errors', done => {
        vol.open('/test.txt', 'w', (err, fd) => {
          expect(err).toBe(null);
          vol.close(fd || -1, err => {
            expect(err).toBe(null);
            done();
          });
        });
      });
    });
    describe('.read(fd, buffer, offset, length, position, callback)', () => {
      const vol = new Volume();
      const data = 'trololo';
      const fileNode = vol._core.createLink(vol._core.root, 'text.txt').getNode();
      fileNode.setString(data);
      vol.symlinkSync('/text.txt', '/link.txt');

      it('Attempt to read from a symlink should throw EPERM', () => {
        const fd = vol.openSync('/link.txt', O_SYMLINK);
        expect(vol.fstatSync(fd).isSymbolicLink()).toBe(true);
        const buf = Buffer.alloc(10);
        const fn = () => vol.readSync(fd, buf, 0, 10, 0);
        expect(fn).toThrowError('EPERM');
      });
    });
    describe('.readv(fd, buffers, position, callback)', () => {
      it('Simple read', done => {
        const vol = new Volume();
        vol.writeFileSync('/test.txt', 'hello');
        const fd = vol.openSync('/test.txt', 'r');

        const buf1 = Buffer.alloc(2);
        const buf2 = Buffer.alloc(2);
        const buf3 = Buffer.alloc(2);
        vol.readv(fd, [buf1, buf2, buf3], 0, (err, bytesRead, buffers) => {
          expect(err).toBe(null);
          expect(bytesRead).toBe(5);
          expect(buffers).toEqual([buf1, buf2, buf3]);
          expect(buf1.toString()).toBe('he');
          expect(buf2.toString()).toBe('ll');
          expect(buf3.toString()).toBe('o\0');
          done();
        });
      });
      it('Read from position', done => {
        const vol = new Volume();
        vol.writeFileSync('/test.txt', 'hello');
        const fd = vol.openSync('/test.txt', 'r');

        const buf1 = Buffer.alloc(2);
        const buf2 = Buffer.alloc(2);
        const buf3 = Buffer.alloc(2, 0);
        vol.readv(fd, [buf1, buf2, buf3], 1, (err, bytesRead, buffers) => {
          expect(err).toBe(null);
          expect(bytesRead).toBe(4);
          expect(buffers).toEqual([buf1, buf2, buf3]);
          expect(buf1.toString()).toBe('el');
          expect(buf2.toString()).toBe('lo');
          expect(buf3.toString()).toBe('\0\0');
          done();
        });
      });
      it('Read from current position', done => {
        const vol = new Volume();
        vol.writeFileSync('/test.txt', 'hello, world!');
        const fd = vol.openSync('/test.txt', 'r');
        vol.readSync(fd, Buffer.alloc(3), 0, 3, null);

        const buf1 = Buffer.alloc(2);
        const buf2 = Buffer.alloc(2);
        const buf3 = Buffer.alloc(2);
        vol.readv(fd, [buf1, buf2, buf3], (err, bytesRead, buffers) => {
          expect(err).toBe(null);
          expect(bytesRead).toBe(6);
          expect(buffers).toEqual([buf1, buf2, buf3]);
          expect(buf1.toString()).toBe('lo');
          expect(buf2.toString()).toBe(', ');
          expect(buf3.toString()).toBe('wo');
          done();
        });
      });
    });
    describe('.readFileSync(path[, options])', () => {
      const vol = new Volume();
      const data = 'trololo';
      const fileNode = vol._core.createLink(vol._core.root, 'text.txt').getNode();
      fileNode.setString(data);

      it('Read file at root (/text.txt)', () => {
        const buf = vol.readFileSync('/text.txt');
        const str = buf.toString();
        expect(buf).toBeInstanceOf(Buffer);
        expect(str).toBe(data);
      });
      it('Read file with path passed as URL', () => {
        const str = vol.readFileSync(new URL('file:///text.txt')).toString();
        expect(str).toBe(data);
      });
      it('Specify encoding as string', () => {
        const str = vol.readFileSync('/text.txt', 'utf8');
        expect(str).toBe(data);
      });
      it('Specify encoding in object', () => {
        const str = vol.readFileSync('/text.txt', { encoding: 'utf8' });
        expect(str).toBe(data);
      });
      it('Read file deep in tree (/dir1/dir2/test-file)', () => {
        const dir1 = vol._core.createLink(vol._core.root, 'dir1', true);
        const dir2 = vol._core.createLink(dir1, 'dir2', true);
        const fileNode = vol._core.createLink(dir2, 'test-file').getNode();
        const data = 'aaaaaa';
        fileNode.setString(data);

        const str = vol.readFileSync('/dir1/dir2/test-file').toString();
        expect(str).toBe(data);
      });
      it('Invalid options should throw', () => {
        try {
          // Expecting this line to throw
          vol.readFileSync('/text.txt', 123 as any);
          throw Error('This should not throw');
        } catch (err) {
          expect(err).toBeInstanceOf(TypeError);
          // TODO: Check the right error message.
        }
      });
      it('Attempt to read a directory should throw EISDIR', () => {
        const vol = new Volume();
        vol.mkdirSync('/test');
        const fn = () => vol.readFileSync('/test');
        expect(fn).toThrowError('EISDIR');
      });
      it('Attempt to read a non-existing file should throw ENOENT', () => {
        const fn = () => vol.readFileSync('/pizza.txt');
        expect(fn).toThrowError('ENOENT');
      });
    });
    describe('.readFile(path[, options], callback)', () => {
      const vol = new Volume();
      const data = 'asdfasdf asdfasdf asdf';
      const fileNode = vol._core.createLink(vol._core.root, 'file.txt').getNode();
      fileNode.setString(data);
      it('Read file at root (/file.txt)', done => {
        vol.readFile('/file.txt', 'utf8', (err, str) => {
          expect(err).toBe(null);
          expect(str).toBe(data);
          done();
        });
      });
    });
    describe('.writeSync(fd, str, position, encoding)', () => {
      const vol = new Volume();
      it('Simple write to a file descriptor', () => {
        const fd = vol.openSync('/test.txt', 'w+');
        const data = 'hello';
        const bytes = vol.writeSync(fd, data);
        vol.closeSync(fd);
        expect(bytes).toBe(data.length);
        expect(vol.readFileSync('/test.txt', 'utf8')).toBe(data);
      });
      it('Multiple writes to a file', () => {
        const fd = vol.openSync('/multi.txt', 'w+');
        const datas = ['hello', ' ', 'world', '!'];
        let bytes = 0;
        for (const data of datas) {
          const b = vol.writeSync(fd, data);
          expect(b).toBe(data.length);
          bytes += b;
        }
        vol.closeSync(fd);
        const result = datas.join('');
        expect(bytes).toBe(result.length);
        expect(vol.readFileSync('/multi.txt', 'utf8')).toBe(result);
      });
      it('Overwrite part of file', () => {
        const fd = vol.openSync('/overwrite.txt', 'w+');
        vol.writeSync(fd, 'martini');
        vol.writeSync(fd, 'Armagedon', 1, 'utf8');
        vol.closeSync(fd);
        expect(vol.readFileSync('/overwrite.txt', 'utf8')).toBe('mArmagedon');
      });
      it('Attempt to write to a symlink should throw EBADF', () => {
        const data = 'asdfasdf asdfasdf asdf';
        vol.writeFileSync('/file.txt', data);
        vol.symlinkSync('/file.txt', '/link.txt');

        const fd = vol.openSync('/link.txt', O_SYMLINK | O_RDWR);
        expect(vol.fstatSync(fd).isSymbolicLink()).toBe(true);
        const fn = () => vol.writeSync(fd, 'hello');
        expect(fn).toThrowError('EBADF');
      });
    });
    describe('.write(fd, buffer, offset, length, position, callback)', () => {
      it('Simple write to a file descriptor', done => {
        const vol = new Volume();
        const fd = vol.openSync('/test.txt', 'w+');
        const data = 'hello';
        vol.write(fd, Buffer.from(data), (err, bytes, buf) => {
          vol.closeSync(fd);
          expect(err).toBe(null);
          expect(vol.readFileSync('/test.txt', 'utf8')).toBe(data);
          done();
        });
      });
    });
    describe('.writev(fd, buffers, position, callback)', () => {
      it('Simple write to a file descriptor', done => {
        const vol = new Volume();
        const fd = vol.openSync('/test.txt', 'w+');
        const data1 = 'Hello';
        const data2 = ', ';
        const data3 = 'world!';
        vol.writev(fd, [Buffer.from(data1), Buffer.from(data2), Buffer.from(data3)], 0, (err, bytes) => {
          expect(err).toBe(null);
          expect(bytes).toBe(data1.length + data2.length + data3.length);
          vol.closeSync(fd);
          expect(vol.readFileSync('/test.txt', 'utf8')).toBe(data1 + data2 + data3);
          done();
        });
      });
    });
    describe('.writeFile(path, data[, options], callback)', () => {
      const vol = new Volume();
      const data = 'asdfasidofjasdf';
      it('Create a file at root (/writeFile.json)', done => {
        vol.writeFile('/writeFile.json', data, err => {
          expect(err).toBe(null);
          const str = tryGetChildNode(vol._core.root, 'writeFile.json').getString();
          expect(str).toBe(data);
          done();
        });
      });
      it('Create a file at root (/writeFile2.json) with exclude flag', done => {
        vol.writeFile('/writeFile2.json', data, { flag: 'wx' }, err => {
          expect(err).toBe(null);
          const str = tryGetChildNode(vol._core.root, 'writeFile2.json').getString();
          expect(str).toBe(data);
          done();
        });
      });
      it('Throws error when no callback provided', () => {
        try {
          vol.writeFile('/asdf.txt', 'asdf', 'utf8', undefined as any);
          throw Error('This should not throw');
        } catch (err) {
          expect(err.message).toBe('callback must be a function');
        }
      });
    });
    describe('.symlinkSync(target, path[, type])', () => {
      const vol = new Volume();
      const jquery = vol._core.createLink(vol._core.root, 'jquery.js').getNode();
      const data = '"use strict";';
      jquery.setString(data);
      it('Create a symlink', () => {
        vol.symlinkSync('/jquery.js', '/test.js');
        expect(vol._core.root.getChild('test.js')).toBeInstanceOf(Link);
        expect(tryGetChildNode(vol._core.root, 'test.js').isSymlink()).toBe(true);
      });
      it('Read from symlink', () => {
        vol.symlinkSync('/jquery.js', '/test2.js');
        expect(vol.readFileSync('/test2.js').toString()).toBe(data);
      });
      describe('Complex, deep, multi-step symlinks get resolved', () => {
        it('Symlink to a folder', () => {
          const vol = Volume.fromJSON({ '/a1/a2/a3/a4/a5/hello.txt': 'world!' });
          vol.symlinkSync('/a1', '/b1');
          expect(vol.readFileSync('/b1/a2/a3/a4/a5/hello.txt', 'utf8')).toBe('world!');
        });
        it('Symlink to a folder to a folder', () => {
          const vol = Volume.fromJSON({ '/a1/a2/a3/a4/a5/hello.txt': 'world!' });
          vol.symlinkSync('/a1', '/b1');
          vol.symlinkSync('/b1', '/c1');
          vol.openSync('/c1/a2/a3/a4/a5/hello.txt', 'r');
        });
        it('Multiple hops to folders', () => {
          const vol = Volume.fromJSON({
            '/a1/a2/a3/a4/a5/hello.txt': 'world a',
            '/b1/b2/b3/b4/b5/hello.txt': 'world b',
            '/c1/c2/c3/c4/c5/hello.txt': 'world c',
          });
          vol.symlinkSync('/a1/a2', '/b1/l');
          vol.symlinkSync('/b1/l', '/b1/b2/b3/ok');
          vol.symlinkSync('/b1/b2/b3/ok', '/c1/a');
          vol.symlinkSync('/c1/a', '/c1/c2/c3/c4/c5/final');
          vol.openSync('/c1/c2/c3/c4/c5/final/a3/a4/a5/hello.txt', 'r');
          expect(vol.readFileSync('/c1/c2/c3/c4/c5/final/a3/a4/a5/hello.txt', 'utf8')).toBe('world a');
        });
      });
      describe('Relative paths', () => {
        it('Creates symlinks with relative paths correctly', () => {
          const vol = Volume.fromJSON({
            '/test/target': 'foo',
            '/test/folder': null,
          });

          // Create symlink using relative path
          vol.symlinkSync('../target', '/test/folder/link');

          // Verify we can read through the symlink
          expect(vol.readFileSync('/test/folder/link', 'utf8')).toBe('foo');

          // Verify the symlink points to the correct location
          const linkPath = vol.readlinkSync('/test/folder/link');
          expect(linkPath).toBe('../target');
        });

        it('Handles nested relative symlinks', () => {
          const vol = Volume.fromJSON({
            '/a/b/target.txt': 'content',
            '/a/c/d': null,
          });

          // Create symlink in nested directory using relative path
          vol.symlinkSync('../../b/target.txt', '/a/c/d/link');

          // Should be able to read through the symlink
          expect(vol.readFileSync('/a/c/d/link', 'utf8')).toBe('content');

          // Create another symlink pointing to the first symlink
          vol.symlinkSync('./d/link', '/a/c/link2');

          // Should be able to read through both symlinks
          expect(vol.readFileSync('/a/c/link2', 'utf8')).toBe('content');
        });

        it('Maintains relative paths when reading symlinks', () => {
          const vol = Volume.fromJSON({
            '/x/y/file.txt': 'test content',
            '/x/z': null,
          });

          // Create symlinks with different relative path patterns
          vol.symlinkSync('../y/file.txt', '/x/z/link1');
          vol.symlinkSync('../../x/y/file.txt', '/x/z/link2');

          // Verify that readlink returns the original relative paths
          expect(vol.readlinkSync('/x/z/link1')).toBe('../y/file.txt');
          expect(vol.readlinkSync('/x/z/link2')).toBe('../../x/y/file.txt');

          // Verify that all symlinks resolve correctly
          expect(vol.readFileSync('/x/z/link1', 'utf8')).toBe('test content');
          expect(vol.readFileSync('/x/z/link2', 'utf8')).toBe('test content');
        });
      });
    });
    describe('.symlink(target, path[, type], callback)', () => {
      xit('...', () => {});
    });
    describe('.realpathSync(path[, options])', () => {
      const vol = new Volume();
      const mootools = vol._core.root.createChild('mootools.js');
      const data = 'String.prototype...';
      mootools.getNode().setString(data);

      const symlink = vol._core.root.createChild('mootools.link.js');
      symlink.getNode().makeSymlink('mootools.js');

      it('Symlink works', () => {
        const resolved = vol._core.resolveSymlinks(symlink);
        expect(resolved).toBe(mootools);
      });
      it('Basic one-jump symlink resolves', () => {
        const path = vol.realpathSync('/mootools.link.js');
        expect(path).toBe('/mootools.js');
      });
      it('Basic one-jump symlink with /./ and /../ in path', () => {
        const path = vol.realpathSync('/./lol/../mootools.link.js');
        expect(path).toBe('/mootools.js');
      });
    });
    describe('.realpath(path[, options], callback)', () => {
      const vol = new Volume();
      const mootools = vol._core.root.createChild('mootools.js');
      const data = 'String.prototype...';
      mootools.getNode().setString(data);

      const symlink = vol._core.root.createChild('mootools.link.js');
      symlink.getNode().makeSymlink('mootools.js');

      it('Basic one-jump symlink resolves', done => {
        vol.realpath('/mootools.link.js', (err, path) => {
          expect(path).toBe('/mootools.js');
          done();
        });
      });
      it('Basic one-jump symlink with /./ and /../ in path', () => {
        vol.realpath('/./lol/../mootools.link.js', (err, path) => {
          expect(path).toBe('/mootools.js');
        });
      });
    });
    describe('.statSync(path, options)', () => {
      const vol = new Volume();

      it('Does not throw when entry does not exist if throwIfNoEntry is false', () => {
        const stat = vol.statSync('/foo', { throwIfNoEntry: false });
        expect(stat).toBeUndefined();
      });
      it('Throws when entry does not exist if throwIfNoEntry is true', () => {
        expect(() => vol.statSync('/foo', { throwIfNoEntry: true })).toThrow();
      });
      it('Throws when entry does not exist if throwIfNoEntry is not specified', () => {
        expect(() => vol.statSync('/foo')).toThrow();
      });
      it('Throws when entry does not exist if throwIfNoEntry is explicitly undefined', () => {
        expect(() => vol.statSync('/foo', { throwIfNoEntry: undefined })).toThrow();
      });
    });
    describe('.lstatSync(path, options)', () => {
      const vol = new Volume();

      it('Does not throw when entry does not exist if throwIfNoEntry is false', () => {
        const stat = vol.lstatSync('/foo', { throwIfNoEntry: false });
        expect(stat).toBeUndefined();
      });
      it('Throws when entry does not exist if throwIfNoEntry is true', () => {
        expect(() => vol.lstatSync('/foo', { throwIfNoEntry: true })).toThrow();
      });
      it('Throws when entry does not exist if throwIfNoEntry is not specified', () => {
        expect(() => vol.lstatSync('/foo')).toThrow();
      });
      it('Throws when entry does not exist if throwIfNoEntry is explicitly undefined', () => {
        expect(() => vol.lstatSync('/foo', { throwIfNoEntry: undefined })).toThrow();
      });
    });
    describe('.lstatSync(path)', () => {
      const vol = new Volume();
      const dojo = vol._core.root.createChild('dojo.js');
      const data = '(function(){})();';
      dojo.getNode().setString(data);

      it('Returns basic file stats', () => {
        const stats = vol.lstatSync('/dojo.js');
        expect(stats).toBeInstanceOf(Stats);
        expect(stats.size).toBe(data.length);
        expect(stats.isFile()).toBe(true);
        expect(stats.isDirectory()).toBe(false);
      });
      it('Returns file stats using BigInt', () => {
        if (hasBigInt) {
          const stats = vol.lstatSync('/dojo.js', { bigint: true });
          expect(typeof stats.ino).toBe('bigint');
          expect(typeof stats.atimeNs).toBe('bigint');
          expect(typeof stats.mtimeNs).toBe('bigint');
          expect(typeof stats.ctimeNs).toBe('bigint');
          expect(typeof stats.birthtimeNs).toBe('bigint');
        } else {
          expect(() => vol.lstatSync('/dojo.js', { bigint: true })).toThrowError();
        }
      });
      it('Stats on symlink returns results about the symlink', () => {
        vol.symlinkSync('/dojo.js', '/link.js');
        const stats = vol.lstatSync('/link.js');
        expect(stats.isSymbolicLink()).toBe(true);
        expect(stats.isFile()).toBe(false);
        expect(stats.size).toBe(0);
      });
      it('Can lstat intermediate directories through symlinks', () => {
        // Create directory structure: /target/subDir/test.txt
        vol.mkdirSync('/target/subDir', { recursive: true });
        vol.writeFileSync('/target/subDir/test.txt', 'Hello World');

        // Create symlink: /link -> /target
        vol.symlinkSync('/target', '/link');

        // lstat should be able to access intermediate directory through symlink
        const stats = vol.lstatSync('/link/subDir');
        expect(stats.isDirectory()).toBe(true);
        expect(stats.isSymbolicLink()).toBe(false);

        // Also verify the file exists through the symlink
        expect(vol.existsSync('/link/subDir/test.txt')).toBe(true);
      });
    });
    describe('.lstat(path, callback)', () => {
      xit('...', () => {});
    });
    describe('.statSync(path)', () => {
      const vol = new Volume();
      const dojo = vol._core.root.createChild('dojo.js');
      const data = '(function(){})();';
      dojo.getNode().setString(data);
      it('Returns basic file stats', () => {
        const stats = vol.statSync('/dojo.js');
        expect(stats).toBeInstanceOf(Stats);
        expect(stats.size).toBe(data.length);
        expect(stats.isFile()).toBe(true);
        expect(stats.isDirectory()).toBe(false);
      });
      it('Returns file stats using BigInt', () => {
        if (hasBigInt) {
          const stats = vol.statSync('/dojo.js', { bigint: true });
          expect(typeof stats.ino).toBe('bigint');
          expect(typeof stats.atimeNs).toBe('bigint');
          expect(typeof stats.mtimeNs).toBe('bigint');
          expect(typeof stats.ctimeNs).toBe('bigint');
          expect(typeof stats.birthtimeNs).toBe('bigint');
        } else {
          expect(() => vol.statSync('/dojo.js', { bigint: true })).toThrowError();
        }
      });
      it('Stats on symlink returns results about the resolved file', () => {
        vol.symlinkSync('/dojo.js', '/link.js');
        const stats = vol.statSync('/link.js');
        expect(stats.isSymbolicLink()).toBe(false);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBe(data.length);
      });
      it('Modification new write', done => {
        vol.writeFileSync('/mtime.txt', '1');
        const stats1 = vol.statSync('/mtime.txt');
        setTimeout(() => {
          vol.writeFileSync('/mtime.txt', '2');
          const stats2 = vol.statSync('/mtime.txt');
          expect(stats2.mtimeMs).toBeGreaterThan(stats1.mtimeMs);
          done();
        }, 2);
      });
    });
    describe('.stat(path, callback)', () => {
      xit('...', () => {});
    });
    describe('.fstatSync(fd)', () => {
      const vol = new Volume();
      const dojo = vol._core.root.createChild('dojo.js');
      const data = '(function(){})();';
      dojo.getNode().setString(data);

      vol.symlinkSync('/dojo.js', '/link.js');

      it('Returns basic file stats', () => {
        const fd = vol.openSync('/dojo.js', 'r');
        const stats = vol.fstatSync(fd);
        expect(stats).toBeInstanceOf(Stats);
        expect(stats.size).toBe(data.length);
        expect(stats.isFile()).toBe(true);
        expect(stats.isDirectory()).toBe(false);
      });
      it('Returns file stats using BigInt', () => {
        const fd = vol.openSync('/dojo.js', 'r');
        if (hasBigInt) {
          const stats = vol.fstatSync(fd, { bigint: true });
          expect(typeof stats.ino).toBe('bigint');
          expect(typeof stats.atimeNs).toBe('bigint');
          expect(typeof stats.mtimeNs).toBe('bigint');
          expect(typeof stats.ctimeNs).toBe('bigint');
          expect(typeof stats.birthtimeNs).toBe('bigint');
        } else {
          expect(() => vol.fstatSync(fd, { bigint: true })).toThrowError();
        }
      });
      it('Returns stats about regular file for fd opened without O_SYMLINK', () => {
        const fd = vol.openSync('/link.js', 0);
        const stats = vol.fstatSync(fd);
        expect(stats).toBeInstanceOf(Stats);
        expect(stats.size).toBe(data.length);
        expect(stats.isFile()).toBe(true);
        expect(stats.isDirectory()).toBe(false);
      });
      it('Returns stats about symlink itself for fd opened with O_SYMLINK', () => {
        const fd = vol.openSync('/link.js', O_SYMLINK);
        const stats = vol.fstatSync(fd);
        expect(stats.isSymbolicLink()).toBe(true);
        expect(stats.isFile()).toBe(false);
        expect(stats.size).toBe(0);
      });
    });
    describe('.fstat(fd, callback)', () => {
      xit('...', () => {});
    });

    describe('.linkSync(existingPath, newPath)', () => {
      const vol = new Volume();
      it('Create a new link', () => {
        const data = '123';
        vol.writeFileSync('/1.txt', data);
        vol.linkSync('/1.txt', '/2.txt');
        expect(vol.readFileSync('/1.txt', 'utf8')).toBe(data);
        expect(vol.readFileSync('/2.txt', 'utf8')).toBe(data);
      });
      it('nlink property of i-node increases when new link is created', () => {
        vol.writeFileSync('/a.txt', '123');
        vol.linkSync('/a.txt', '/b.txt');
        vol.linkSync('/a.txt', '/c.txt');
        const stats = vol.statSync('/b.txt');
        expect(stats.nlink).toBe(3);
      });
    });
    describe('.link(existingPath, newPath, callback)', () => {
      xit('...', () => {});
    });
    describe('.readdirSync(path)', () => {
      it('Returns simple list', () => {
        const vol = new Volume();
        vol.writeFileSync('/1.js', '123');
        vol.writeFileSync('/2.js', '123');
        const list = vol.readdirSync('/');
        expect(list.length).toBe(2);
        expect(list).toEqual(['1.js', '2.js']);
      });
      it('Returns a Dirent list', () => {
        const vol = new Volume();
        vol.writeFileSync('/1', '123');
        vol.mkdirSync('/2');
        const list = vol.readdirSync('/', { withFileTypes: true });
        expect(list.length).toBe(2);
        expect(list[0]).toBeInstanceOf(Dirent);
        const dirent0 = list[0] as Dirent;
        expect(dirent0.name).toBe('1');
        expect(dirent0.isFile()).toBe(true);
        const dirent1 = list[1] as Dirent;
        expect(dirent1.name).toBe('2');
        expect(dirent1.isDirectory()).toBe(true);
      });
    });
    describe('.readdir(path, callback)', () => {
      xit('...', () => {});
    });
    describe('.readlinkSync(path[, options])', () => {
      it('Simple symbolic link to one file', () => {
        const vol = new Volume();
        vol.writeFileSync('/1', '123');
        vol.symlinkSync('/1', '/2');
        const res = vol.readlinkSync('/2');
        expect(res).toBe('/1');
      });
    });
    describe('.readlink(path[, options], callback)', () => {
      it('Simple symbolic link to one file', done => {
        const vol = new Volume();
        vol.writeFileSync('/1', '123');
        vol.symlink('/1', '/2', err => {
          vol.readlink('/2', (err, res) => {
            expect(res).toBe('/1');
            done();
          });
        });
      });
    });
    describe('.fsyncSync(fd)', () => {
      const vol = new Volume();
      const fd = vol.openSync('/lol', 'w');
      it('Executes without crashing', () => {
        vol.fsyncSync(fd);
      });
    });
    describe('.fsync(fd, callback)', () => {
      const vol = new Volume();
      const fd = vol.openSync('/lol', 'w');
      it('Executes without crashing', done => {
        vol.fsync(fd, done);
      });
    });
    describe('.ftruncateSync(fd[, len])', () => {
      const vol = new Volume();
      it('Truncates to 0 single file', () => {
        const fd = vol.openSync('/trunky', 'w');
        vol.writeFileSync(fd, '12345');
        expect(vol.readFileSync('/trunky', 'utf8')).toBe('12345');
        vol.ftruncateSync(fd);
        expect(vol.readFileSync('/trunky', 'utf8')).toBe('');
      });
    });
    describe('.ftruncate(fd[, len], callback)', () => {
      xit('...', () => {});
    });
    describe('.truncateSync(path[, len])', () => {
      const vol = new Volume();
      it('Truncates to 0 single file', () => {
        const fd = vol.openSync('/trunky', 'w');
        vol.writeFileSync(fd, '12345');
        expect(vol.readFileSync('/trunky', 'utf8')).toBe('12345');
        vol.truncateSync('/trunky');
        expect(vol.readFileSync('/trunky', 'utf8')).toBe('');
      });
      it('Partial truncate', () => {
        const fd = vol.openSync('/1', 'w');
        vol.writeFileSync(fd, '12345');
        expect(vol.readFileSync('/1', 'utf8')).toBe('12345');
        vol.truncateSync('/1', 2);
        expect(vol.readFileSync('/1', 'utf8')).toBe('12');
      });
      it('Larger truncate', () => {
        const fd = vol.openSync('/2', 'w');
        vol.writeFileSync(fd, '12345');
        expect(vol.readFileSync('/2', 'utf8')).toBe('12345');
        vol.truncateSync('/2', 10);
        expect(vol.readFileSync('/2', 'utf8')).toBe('12345\0\0\0\0\0');
      });
    });
    describe('.truncate(path[, len], callback)', () => {
      xit('...', () => {});
    });
    describe('.utimesSync(path, atime, mtime)', () => {
      const vol = new Volume();
      vol.mkdirSync('/foo');
      it('Set times on file', () => {
        vol.writeFileSync('/foo/lol', '12345');
        vol.utimesSync('/foo/lol', 1234, 12345);
        const stats = vol.statSync('/foo/lol');
        expect(Math.round(stats.atime.getTime() / 1000)).toBe(1234);
        expect(Math.round(stats.mtime.getTime() / 1000)).toBe(12345);
      });
      it('Sets times on a directory', () => {
        vol.utimesSync('/foo', 1234, 12345);
        const stats = vol.statSync('/foo');
        expect(Math.round(stats.atime.getTime() / 1000)).toBe(1234);
        expect(Math.round(stats.mtime.getTime() / 1000)).toBe(12345);
      });
    });
    describe('.utimes(path, atime, mtime, callback)', () => {
      xit('...', () => {});
    });
    describe('.mkdirSync(path[, options])', () => {
      it('Create dir at root', () => {
        const vol = new Volume();
        const oldMtime = vol._core.root.getNode().mtime;
        const oldNlink = vol._core.root.getNode().nlink;
        vol.mkdirSync('/test');
        const newMtime = vol._core.root.getNode().mtime;
        const newNlink = vol._core.root.getNode().nlink;
        const child = tryGetChild(vol._core.root, 'test');
        expect(child).toBeInstanceOf(Link);
        expect(child.getNode().isDirectory()).toBe(true);
        expect(oldMtime).not.toBe(newMtime);
        expect(newNlink).toBe(oldNlink + 1);
      });
      it('Create 2 levels deep folders', () => {
        const vol = new Volume();
        vol.mkdirSync('/dir1');
        vol.mkdirSync('/dir1/dir2');
        const dir1 = tryGetChild(vol._core.root, 'dir1');
        expect(dir1).toBeInstanceOf(Link);
        expect(dir1.getNode().isDirectory()).toBe(true);
        const dir2 = tryGetChild(dir1, 'dir2');
        expect(dir2).toBeInstanceOf(Link);
        expect(dir2.getNode().isDirectory()).toBe(true);
        expect(dir2.getPath()).toBe('/dir1/dir2');
      });
      it('Create /dir1/dir2/dir3 recursively', () => {
        const vol = new Volume();
        const fullPath = vol.mkdirSync('/dir1/dir2/dir3', { recursive: true });
        const dir1 = tryGetChild(vol._core.root, 'dir1');
        const dir2 = tryGetChild(dir1, 'dir2');
        const dir3 = tryGetChild(dir2, 'dir3');
        expect(dir1).toBeInstanceOf(Link);
        expect(dir2).toBeInstanceOf(Link);
        expect(dir3).toBeInstanceOf(Link);
        expect(dir1.getNode().isDirectory()).toBe(true);
        expect(dir2.getNode().isDirectory()).toBe(true);
        expect(dir3.getNode().isDirectory()).toBe(true);
        expect(fullPath).toBe('/dir1/dir2/dir3');
        const dirAlreadyExists = vol.mkdirSync('/dir1/dir2/dir3', { recursive: true });
        expect(dirAlreadyExists).toBe(undefined);
      });
    });
    describe('.mkdir(path[, mode], callback)', () => {
      xit('...', () => {});
      xit('Create /dir1/dir2/dir3', () => {});
    });
    describe('.mkdtempSync(prefix[, options])', () => {
      it('Create temp dir at root', () => {
        const vol = new Volume();
        const name = vol.mkdtempSync('/tmp-');
        vol.writeFileSync(name + '/file.txt', 'lol');
        expect(vol.toJSON()).toEqual({ [name + '/file.txt']: 'lol' });
      });
      it('throws when prefix is not a string', () => {
        const vol = new Volume();
        expect(() => vol.mkdtempSync({} as string)).toThrow(TypeError);
      });
      it('throws when prefix contains null bytes', () => {
        const vol = new Volume();
        expect(() => vol.mkdtempSync('/tmp-\u0000')).toThrow(/path.+string.+null bytes/i);
      });
    });
    describe('.mkdtemp(prefix[, options], callback)', () => {
      xit('Create temp dir at root', () => {});
      it('throws when prefix is not a string', () => {
        const vol = new Volume();
        expect(() => vol.mkdtemp({} as string, () => {})).toThrow(TypeError);
      });
      it('throws when prefix contains null bytes', () => {
        const vol = new Volume();
        expect(() => vol.mkdtemp('/tmp-\u0000', () => {})).toThrow(/path.+string.+null bytes/i);
      });
    });
    describe('.rmdirSync(path)', () => {
      it('Remove single dir', () => {
        const vol = new Volume();
        vol.mkdirSync('/dir');
        expect(tryGetChildNode(vol._core.root, 'dir').isDirectory()).toBe(true);
        vol.rmdirSync('/dir');
        expect(!!vol._core.root.getChild('dir')).toBe(false);
      });
      it('Remove dir /dir1/dir2/dir3 recursively', () => {
        const vol = new Volume();
        vol.mkdirSync('/dir1/dir2/dir3', { recursive: true });
        vol.rmdirSync('/dir1', { recursive: true });
        expect(!!vol._core.root.getChild('dir1')).toBe(false);
      });
    });
    describe('.rmdir(path, callback)', () => {
      xit('Remove single dir', () => {});
      it('Async remove dir /dir1/dir2/dir3 recursively', done => {
        const vol = new Volume();
        vol.mkdirSync('/dir1/dir2/dir3', { recursive: true });
        vol.rmdir('/dir1', { recursive: true }, () => {
          expect(!!vol._core.root.getChild('dir1')).toBe(false);
          done();
        });
      });
    });
    describe('.watch(path[, options], listener)', () => {
      it('should handle watching a file correctly', () => {
        const vol = Volume.fromJSON({ '/tmp/foo.js': 'hello test' });
        vol.writeFileSync('/tmp/foo.js', 'hello test');

        const mockCallback = jest.fn();
        const writtenContent = 'hello world';
        const watcher = vol.watch('/tmp/foo.js', mockCallback as any);

        try {
          vol.writeFileSync('/tmp/foo.js', writtenContent);

          expect(mockCallback).toBeCalledTimes(2);
          expect(mockCallback).toBeCalledWith('change', 'foo.js');
        } finally {
          watcher.close();
        }
      });

      it('should handle watching a directory correctly', () => {
        const vol = Volume.fromJSON({ '/tmp/foo.js': 'hello test' });
        vol.mkdirSync('/tmp/foo-dir');

        const mockCallback = jest.fn();
        const writtenContent = 'hello world';
        const watcher = vol.watch('/tmp/foo-dir', mockCallback as any);

        try {
          vol.writeFileSync('/tmp/foo-dir/foo.js', writtenContent);

          expect(mockCallback).toBeCalledTimes(3);
          expect(mockCallback).nthCalledWith(1, 'rename', 'foo.js');
          expect(mockCallback).nthCalledWith(2, 'change', 'foo.js');
          expect(mockCallback).nthCalledWith(3, 'change', 'foo.js');
        } finally {
          watcher.close();
        }
      });

      it('handles directories being renamed', () => {
        const vol = Volume.fromJSON({ '/1': null });

        const mockCallback = jest.fn();
        const watcher = vol.watch('/', mockCallback as any);

        try {
          expect(() => vol.renameSync('/1', '/2')).not.toThrow();
          expect(mockCallback).toHaveBeenCalledWith('rename', '1');
          expect(mockCallback).toHaveBeenCalledWith('rename', '2');
        } finally {
          watcher.close();
        }
      });

      it('Calls listener on .watch when renaming with recursive=true', done => {
        const vol = new Volume();
        vol.mkdirSync('/test');
        vol.writeFileSync('/test/lol.txt', 'foo');
        setTimeout(() => {
          const listener = jest.fn();
          const watcher = vol.watch('/', { recursive: true }, listener);

          vol.renameSync('/test/lol.txt', '/test/lol-2.txt');

          setTimeout(() => {
            watcher.close();
            expect(listener).toBeCalledTimes(2);
            expect(listener).nthCalledWith(1, 'rename', 'test/lol.txt');
            expect(listener).nthCalledWith(2, 'rename', 'test/lol-2.txt');
            done();
          }, 10);
        });
      });
      it('Calls listener on .watch with recursive=true', done => {
        const vol = new Volume();
        vol.writeFileSync('/lol.txt', '1');
        vol.mkdirSync('/test');
        setTimeout(() => {
          const listener = jest.fn();
          const watcher = vol.watch('/', { recursive: true }, listener);
          vol.writeFileSync('/lol.txt', '2');
          vol.writeFileSync('/test/lol.txt', '2');
          vol.rmSync('/lol.txt');
          vol.rmSync('/test/lol.txt');
          vol.mkdirSync('/test/foo');

          setTimeout(() => {
            watcher.close();
            expect(listener).toBeCalledTimes(8);
            expect(listener).nthCalledWith(1, 'change', 'lol.txt');
            expect(listener).nthCalledWith(2, 'change', 'lol.txt');
            expect(listener).nthCalledWith(3, 'rename', 'test/lol.txt');
            expect(listener).nthCalledWith(4, 'change', 'test/lol.txt');
            expect(listener).nthCalledWith(5, 'change', 'test/lol.txt');
            expect(listener).nthCalledWith(6, 'rename', 'lol.txt');
            expect(listener).nthCalledWith(7, 'rename', 'test/lol.txt');
            expect(listener).nthCalledWith(8, 'rename', 'test/foo');
            done();
          }, 10);
        });
      });
      it('Calls listener on .watch with recursive=false', done => {
        const vol = new Volume();
        vol.writeFileSync('/lol.txt', '1');
        vol.mkdirSync('/test');
        setTimeout(() => {
          const listener = jest.fn();
          const watcher = vol.watch('/', { recursive: false }, listener);
          vol.writeFileSync('/lol.txt', '2');
          vol.rmSync('/lol.txt');
          vol.writeFileSync('/test/lol.txt', '2');
          vol.rmSync('/test/lol.txt');

          setTimeout(() => {
            watcher.close();
            expect(listener).toBeCalledTimes(3);
            expect(listener).nthCalledWith(1, 'change', 'lol.txt');
            expect(listener).nthCalledWith(2, 'change', 'lol.txt');
            expect(listener).nthCalledWith(3, 'rename', 'lol.txt');
            done();
          }, 10);
        });
      });
      it('Calls listener for file created immediately after directory creation', done => {
        const vol = new Volume();
        vol.mkdirSync('/watched', { recursive: true });

        const listener = jest.fn();
        const watcher = vol.watch('/watched', { recursive: true }, listener);

        // Create directory and immediately create file inside it
        vol.mkdirSync('/watched/new_dir', { recursive: true });
        vol.writeFileSync('/watched/new_dir/new_file', 'content');

        setTimeout(() => {
          watcher.close();

          // Should have at least 3 events: directory creation, file creation, file change
          expect(listener).toHaveBeenCalledWith('rename', 'new_dir');
          expect(listener).toHaveBeenCalledWith('rename', 'new_dir/new_file');
          expect(listener).toHaveBeenCalledWith('change', 'new_dir/new_file');

          done();
        }, 10);
      });
    });
    describe('.watchFile(path[, options], listener)', () => {
      it('Calls listener on .writeFile', done => {
        const vol = new Volume();
        vol.writeFileSync('/lol.txt', '1');
        setTimeout(() => {
          vol.watchFile('/lol.txt', { interval: 1 }, (curr, prev) => {
            queueMicrotask(() => {
              vol.unwatchFile('/lol.txt');
              done();
            });
          });
          vol.writeFileSync('/lol.txt', '2');
        }, 1);
      });
      xit('Multiple listeners for one file', () => {});
    });
    describe('.unwatchFile(path[, listener])', () => {
      it('Stops watching before .writeFile', done => {
        const vol = new Volume();
        vol.writeFileSync('/lol.txt', '1');
        setTimeout(() => {
          let listenerCalled = false;
          vol.watchFile('/lol.txt', { interval: 1 }, (curr, prev) => {
            listenerCalled = true;
          });
          vol.unwatchFile('/lol.txt');
          vol.writeFileSync('/lol.txt', '2');
          setTimeout(() => {
            expect(listenerCalled).toBe(false);
            done();
          }, 10);
        }, 1);
      });
    });
    describe('.chmodSync(path, mode)', () => {
      it('works with directories', () => {
        const vol = new Volume();
        vol.mkdirSync('/dir');
        vol.chmodSync('/dir', 0o666);
        expect(vol.statSync('/dir').mode.toString(8)).toBe('40666');
        vol.chmodSync('/dir', 0o777);
        expect(vol.statSync('/dir').mode.toString(8)).toBe('40777');
      });
      it('works with files', () => {
        const vol = new Volume();
        vol.writeFileSync('/file', 'contents');
        vol.chmodSync('/file', 0o666);
        expect(vol.statSync('/file').mode.toString(8)).toBe('100666');
        vol.chmodSync('/file', 0o777);
        expect(vol.statSync('/file').mode.toString(8)).toBe('100777');
      });
    });
    describe('.promises', () => {
      it('Have a promises property', () => {
        const vol = new Volume();
        expect(typeof vol.promises).toBe('object');
      });
    });
  });
  describe('StatWatcher', () => {
    it('.vol points to current volume', () => {
      const vol = new Volume();
      expect(new StatWatcher(vol).vol).toBe(vol);
    });
  });
  describe('.createWriteStream', () => {
    it('accepts filehandle as fd option', async () => {
      const vol = new Volume();
      const fh = await vol.promises.open('/test.txt', 'wx', 0o600);
      const writeStream = vol.createWriteStream('', { fd: fh });
      await promisify(writeStream.write.bind(writeStream))(Buffer.from('Hello'));
      await promisify(writeStream.close.bind(writeStream))();
      expect(vol.toJSON()).toEqual({
        '/test.txt': 'Hello',
      });
    });
  });
  describe('.createReadStream', () => {
    it('accepts filehandle as fd option', done => {
      const vol = Volume.fromJSON({
        '/test.txt': 'Hello',
      });
      vol.promises
        .open('/test.txt', 'r')
        .then(fh => {
          const readStream = vol.createReadStream('/this/should/be/ignored', { fd: fh });
          readStream.setEncoding('utf8');
          let readData = '';
          readStream.on('readable', () => {
            const chunk = readStream.read();
            if (chunk != null) readData += chunk;
          });
          readStream.on('end', () => {
            expect(readData).toEqual('Hello');
            done();
          });
        })
        .catch(err => {
          expect(err).toBeNull();
        });
    });
  });
});
