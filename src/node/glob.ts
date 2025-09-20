import { join, relative, resolve, posix, isAbsolute, dirname, basename } from '../vendor/node/path';
import { toRegex } from 'glob-to-regex.js';
import { IGlobOptions } from './types/options';
import { pathToFilename } from './util';
import Dirent from './Dirent';

const pathJoin = posix.join;
const pathRelative = posix.relative;
const pathResolve = posix.resolve;

/**
 * Check if a path matches a glob pattern
 */
function matchesPattern(path: string, pattern: string): boolean {
  const regex = toRegex(pattern);
  return regex.test(path);
}

/**
 * Check if a path should be excluded based on exclude patterns
 */
function isExcluded(path: string, exclude: string | string[] | ((path: string) => boolean) | undefined): boolean {
  if (!exclude) return false;

  if (typeof exclude === 'function') {
    return exclude(path);
  }

  const patterns = Array.isArray(exclude) ? exclude : [exclude];
  return patterns.some(pattern => matchesPattern(path, pattern));
}

/**
 * Walk directory tree and collect matching paths
 */
function walkDirectory(fs: any, dir: string, patterns: string[], options: IGlobOptions, currentDepth = 0): string[] {
  const results: string[] = [];
  const maxDepth = options.maxdepth ?? Infinity;
  const baseCwd = options.cwd ? pathToFilename(options.cwd as any) : process.cwd();

  if (currentDepth > maxDepth) {
    return results;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }) as Dirent[];

    for (const entry of entries) {
      const fullPath = pathJoin(dir, entry.name.toString());
      const relativePath = pathRelative(baseCwd, fullPath);

      // Skip if excluded
      if (isExcluded(relativePath, options.exclude)) {
        continue;
      }

      // Check if this path matches any pattern
      const matches = patterns.some(pattern => matchesPattern(relativePath, pattern));
      if (matches) {
        results.push(relativePath);
      }

      // Recurse into directories
      if (entry.isDirectory() && currentDepth < maxDepth) {
        const subResults = walkDirectory(fs, fullPath, patterns, options, currentDepth + 1);
        results.push(...subResults);
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }

  return results;
}

/**
 * Main glob implementation
 */
export function globSync(fs: any, pattern: string, options: IGlobOptions = {}): string[] {
  const cwd = options.cwd ? pathToFilename(options.cwd as any) : process.cwd();
  const resolvedCwd = pathResolve(cwd);

  const globOptions: IGlobOptions = {
    cwd: resolvedCwd,
    exclude: options.exclude,
    maxdepth: options.maxdepth,
    withFileTypes: options.withFileTypes || false,
  };

  let results: string[] = [];

  // Handle absolute patterns
  if (posix.isAbsolute(pattern)) {
    const dir = posix.dirname(pattern);
    const patternBasename = posix.basename(pattern);
    const dirResults = walkDirectory(fs, dir, [patternBasename], { ...globOptions, cwd: dir });
    results.push(...dirResults.map(r => posix.resolve(dir, r)));
  } else {
    // Handle relative patterns
    const dirResults = walkDirectory(fs, resolvedCwd, [pattern], globOptions);
    results.push(...dirResults);
  }

  // Remove duplicates and sort
  results = [...new Set(results)].sort();

  return results;
}
