import type { CoreFsaContext } from './types';

/**
 * Creates a new {@link CoreFsaContext}.
 */
export const ctx = (partial: Partial<CoreFsaContext> = {}): CoreFsaContext => {
  return {
    separator: '/',
    syncHandleAllowed: false,
    mode: 'read',
    ...partial,
  };
};

export const basename = (path: string, separator: string) => {
  if (path[path.length - 1] === separator) path = path.slice(0, -1);
  const lastSlashIndex = path.lastIndexOf(separator);
  return lastSlashIndex === -1 ? path : path.slice(lastSlashIndex + 1);
};

const nameRegex = /^(\.{1,2})$|[\/\\]/;

export const assertName = (name: string, method: string, klass: string) => {
  const isInvalid = !name || nameRegex.test(name);
  if (isInvalid) throw new TypeError(`Failed to execute '${method}' on '${klass}': Name is not allowed.`);
};

export const assertCanWrite = (mode: 'read' | 'readwrite') => {
  if (mode !== 'readwrite')
    throw new DOMException(
      'The request is not allowed by the user agent or the platform in the current context.',
      'NotAllowedError',
    );
};

export const newNotFoundError = () =>
  new DOMException(
    'A requested file or directory could not be found at the time an operation was processed.',
    'NotFoundError',
  );

export const newTypeMismatchError = () =>
  new DOMException('The path supplied exists, but was not an entry of requested type.', 'TypeMismatchError');

export const newNotAllowedError = () => new DOMException('Permission not granted.', 'NotAllowedError');
