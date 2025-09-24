import { createFs } from '../../../__tests__/util';
import { normalize, dirname } from '../../../vendor/node/path';

describe('openSync(path, mode[, flags])', () => {
  it('should return a file descriptor', () => {
    const fs = createFs();
    const fd = fs.openSync('/foo', 'w');
    expect(typeof fd).toEqual('number');
  });

  it('throws ENOTDIR when trying to create a non-existent file inside another file', () => {
    const fs = createFs();

    expect(() => {
      fs.openSync('/foo/baz', 'a');
    }).toThrow(/ENOTDIR/);
  });

  describe('permissions', () => {
    it('opening for writing throws EACCES without sufficient permissions on the file', () => {
      const flags = ['a', 'w', 'r+']; // append, write, read+write
      flags.forEach(intent => {
        const fs = createFs();
        fs.chmodSync('/foo', 0o555); // rx across the board
        expect(() => {
          fs.openSync('/foo', intent);
        }).toThrowError(/EACCES/);
      });
    });

    it('opening for reading throws EACCES without sufficient permissions on the file', () => {
      const flags = ['a+', 'r', 'w+']; // append+read, read, write+read
      flags.forEach(intent => {
        const fs = createFs();
        fs.chmodSync('/foo', 0o333); // wx across the board
        expect(() => {
          fs.openSync('/foo', intent);
        }).toThrowError(/EACCES/);
      });
    });

    it('opening for anything throws EACCES without sufficient permissions on the containing directory of an existing file', () => {
      const flags = ['a+', 'r', 'w']; // append+read, read, write
      flags.forEach(intent => {
        const fs = createFs({ '/foo/bar': 'test' });
        fs.chmodSync('/foo', 0o666); // wr across the board
        expect(() => {
          fs.openSync('/foo/bar', intent);
        }).toThrowError(/EACCES/);
      });
    });

    it('opening for anything throws EACCES without sufficient permissions on an intermediate directory', () => {
      const flags = ['a+', 'r', 'w']; // append+read, read, write
      flags.forEach(intent => {
        const fs = createFs({ '/foo/bar': 'test' });
        fs.chmodSync('/', 0o666); // wr across the board
        expect(() => {
          fs.openSync('/foo/bar', intent);
        }).toThrowError(/EACCES/);
      });
    });

    it('opening for anything throws EACCES without sufficient permissions on the containing directory of an non-existent file', () => {
      const flags = ['a+', 'r', 'w']; // append+read, read, write
      flags.forEach(intent => {
        const fs = createFs({});
        fs.mkdirSync('/foo', { mode: 0o666 }); // wr
        expect(() => {
          fs.openSync('/foo/bar', intent);
        }).toThrowError(/EACCES/);
      });
    });

    it('should open file when using native file seperators', () => {
      const fs = createFs({});
      // Normalize the path to match the current operating system's format.
      // This is crucial for catching path-related issues that arise when using native paths on Windows.
      const filePath = normalize('/foo/bar.txt');

      fs.mkdirSync(dirname(filePath));
      fs.writeFileSync(filePath, 'test');

      expect(() => fs.openSync(filePath, 'r')).not.toThrow();
    });
  });
});
