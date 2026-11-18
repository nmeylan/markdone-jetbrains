// L1: which inline code counts as a project file path.
import { describe, expect, it } from 'vitest';

import { codePath } from '../../src/live-preview';

describe('codePath', () => {
  it('accepts relative paths and file names with an extension', () => {
    expect(codePath('src/main/Foo.kt')).toBe('src/main/Foo.kt');
    expect(codePath('README.md')).toBe('README.md');
    expect(codePath('../docs/a.md')).toBe('../docs/a.md');
    expect(codePath(' src/utils ')).toBe('src/utils');
  });

  it('refuses absolute paths, schemes, spaces and plain words', () => {
    expect(codePath('/etc/passwd')).toBeNull();
    expect(codePath('~/x/y')).toBeNull();
    expect(codePath('C:/x/y.txt')).toBeNull();
    expect(codePath('https://a.b/c')).toBeNull();
    expect(codePath('a b/c.kt')).toBeNull();
    expect(codePath('foo')).toBeNull();
    expect(codePath('dir/')).toBeNull();
  });
});
