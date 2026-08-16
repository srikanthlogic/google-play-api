document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.topbar nav');
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (!nav) return;
  nav.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && href !== '/docs/') {
      const target = href.split('/').pop();
      if (path.endsWith(target)) a.style.color = 'var(--text)';
    } else if (path === '/docs' || path === '/docs/') {
      a.style.color = 'var(--text)';
    }
  });
});
