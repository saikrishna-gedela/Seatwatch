// Page helper: reports the page title / release hint to the popup on request.
// It reads only the document title and meta tags. It never touches account data.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'pageInfo') {
    const og = document.querySelector('meta[property="og:title"]');
    const title = (og && og.content) || document.title || '';
    reply({ title: title.replace(/\s*[|\-–].*$/, '').trim() });
  }
});
