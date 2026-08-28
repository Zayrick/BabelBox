export function resolvesToDarkTheme(theme: string | undefined, prefersDark: boolean): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return prefersDark
}
