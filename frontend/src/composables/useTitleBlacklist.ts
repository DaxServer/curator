import { ref } from 'vue'

const error = ref<string | null>(null)

export const useTitleBlacklist = () => {
  const isBlacklisted = (title: string): boolean => {
    // 1. Base names whose length exceeds 255 bytes
    // Note: This is a byte length check, not character length
    const encoder = new TextEncoder()
    const byteLength = encoder.encode(title).length
    if (byteLength > 255) {
      return true
    }

    // 2. Base names equal to "." or ".."
    if (title === '.' || title === '..') {
      return true
    }

    // 3. Titles with an invalid UTF-8 sequence
    // This is handled by JavaScript's string handling, but we'll check for replacement characters
    if (title.includes('\uFFFD')) {
      return true
    }

    // 5. Titles beginning or ending with a space (underscore), or containing two or more consecutive spaces (underscores)
    if (
      title.startsWith(' ') ||
      title.endsWith(' ') ||
      title.startsWith('_') ||
      title.endsWith('_')
    ) {
      return true
    }

    if (/\s{2,}/.test(title) || /_{2,}/.test(title)) {
      return true
    }

    // Space immediately before the file extension (e.g. "Example .png")
    if (/\s+\.[a-zA-Z0-9]+$/.test(title)) {
      return true
    }

    // 6. Titles containing 3 or more consecutive tildes
    if (/~{3,}/.test(title)) {
      return true
    }

    // 7. Titles containing % followed by two hexadecimal digits (percent-encoding)
    if (/%[0-9A-Fa-f]{2}/.test(title)) {
      return true
    }

    // 8. Titles containing invalid characters
    // # < > [ ] | { } : /
    // non-printable ASCII characters 0–31
    // the "delete" character 127
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally checking for control characters
    if (/[#<>[\]|{}:/]/.test(title) || /[\x00-\x1F\x7F]/.test(title)) {
      return true
    }

    // 9. HTML character codes such as &amp;
    if (/&[a-zA-Z][a-zA-Z0-9]*;/.test(title)) {
      return true
    }

    // 15. Base names beginning with a lower-case letter
    if (/^[a-z]/.test(title)) {
      return true
    }

    return false
  }

  const reset = (): void => {
    error.value = null
  }

  return {
    isBlacklisted,
    error,
    reset,
  }
}
