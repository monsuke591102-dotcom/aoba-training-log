export function canDeleteMenusLocally() {
  return __LOCAL_MENU_DELETE__ && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}
