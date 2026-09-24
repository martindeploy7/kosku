try {
  var prefs = JSON.parse(localStorage.getItem('kosku-prefs') || '{}')
  if (prefs.theme === 'dark') {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
  }
} catch (e) {}
