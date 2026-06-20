import { useTitleBlacklist } from '@frontend/composables/useTitleBlacklist'
import { describe, expect, it } from 'bun:test'

describe('useTitleBlacklist', () => {
  const { isBlacklisted } = useTitleBlacklist()

  it('should blacklist titles starting with lowercase letter', () => {
    expect(isBlacklisted('test.jpg')).toBe(true)
    expect(isBlacklisted('photo.png')).toBe(true)
  })

  it('should not blacklist titles starting with uppercase letter', () => {
    expect(isBlacklisted('Test.jpg')).toBe(false)
    expect(isBlacklisted('Photo.png')).toBe(false)
  })

  it('should blacklist titles with invalid characters', () => {
    const invalidChars = ['#', '<', '>', '[', ']', '|', '{', '}', ':', '/']

    invalidChars.forEach((char) => {
      expect(isBlacklisted(`Test${char}file.jpg`)).toBe(true)
    })
  })

  it('should blacklist titles with non-printable ASCII characters', () => {
    expect(isBlacklisted('Test\x00file.jpg')).toBe(true)
    expect(isBlacklisted('Test\x1Ffile.jpg')).toBe(true)
    expect(isBlacklisted('Test\x7Ffile.jpg')).toBe(true)
  })

  it('should blacklist titles with HTML character codes', () => {
    expect(isBlacklisted('Test&amp;file.jpg')).toBe(true)
    expect(isBlacklisted('Test&lt;file.jpg')).toBe(true)
    expect(isBlacklisted('Test&gt;file.jpg')).toBe(true)
  })

  it('should blacklist titles equal to "." or ".."', () => {
    expect(isBlacklisted('.')).toBe(true)
    expect(isBlacklisted('..')).toBe(true)
  })

  it('should blacklist titles exceeding 255 byte limit', () => {
    // Create a string that's 256 bytes when UTF-8 encoded
    const longTitle = `A${'€'.repeat(127)}` // € is 3 bytes in UTF-8, so 1 + 127*3 = 382 bytes
    expect(isBlacklisted(longTitle)).toBe(true)
  })

  it('should not blacklist titles within 255 byte limit', () => {
    const validTitle = `A${'€'.repeat(84)}` // € is 3 bytes in UTF-8, so 1 + 84*3 = 253 bytes
    expect(isBlacklisted(validTitle)).toBe(false)
  })

  it('should blacklist titles with invalid UTF-8 sequences', () => {
    expect(isBlacklisted('Test\uFFFDfile.jpg')).toBe(true)
  })

  it('should blacklist titles starting or ending with space or underscore', () => {
    expect(isBlacklisted(' Test.jpg')).toBe(true)
    expect(isBlacklisted('Test.jpg ')).toBe(true)
    expect(isBlacklisted('_Test.jpg')).toBe(true)
    expect(isBlacklisted('Test.jpg_')).toBe(true)
  })

  it('should blacklist titles with consecutive spaces or underscores', () => {
    expect(isBlacklisted('Test  file.jpg')).toBe(true)
    expect(isBlacklisted('Test__file.jpg')).toBe(true)
  })

  it('should blacklist titles with 3 or more consecutive tildes', () => {
    expect(isBlacklisted('Test~~~file.jpg')).toBe(true)
    expect(isBlacklisted('Test~~~~file.jpg')).toBe(true)
  })

  it('should blacklist titles with percent-encoded sequences', () => {
    expect(isBlacklisted('Test%20file.jpg')).toBe(true)
    expect(isBlacklisted('Test%2Ffile.jpg')).toBe(true)
  })

  it('should blacklist titles with a space before the extension', () => {
    expect(isBlacklisted('Example .png')).toBe(true)
    expect(isBlacklisted('My file .jpg')).toBe(true)
    expect(isBlacklisted('Photo .jpeg')).toBe(true)
  })

  it('should not blacklist valid titles', () => {
    // Valid titles should not be blacklisted (no remote blacklist checking)
    expect(isBlacklisted('ValidFile.jpg')).toBe(false)
    expect(isBlacklisted('MyPhoto.png')).toBe(false)
    expect(isBlacklisted('Test123.gif')).toBe(false)
  })
})
