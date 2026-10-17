/** Read DOM structure only; no hiding, navigation, or changes to the page. */
export function inspectYouTube(driver) {
  return driver.executeScript(() => {
    const describe = element => ({
      tag: element.localName,
      attributes: Object.fromEntries([...element.attributes]
        .filter(attribute => ['id', 'class', 'role', 'href', 'is-shorts', 'aria-label', 'tab-title', 'aria-selected'].includes(attribute.name))
        .map(attribute => [attribute.name, attribute.value])),
    });
    const describeLink = link => {
      const ancestors = [];
      for (let element = link.parentElement; element && ancestors.length < 8; element = element.parentElement) {
        ancestors.push(describe(element));
      }
      return { ...describe(link), ancestors };
    };
    const links = [...document.querySelectorAll('a[href]')];
    const shorts = links.filter(link => {
      const url = new URL(link.href, location.href);
      return ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
        && /^\/shorts(?:\/|$)/.test(url.pathname);
    });
    const regular = links.filter(link => new URL(link.href, location.href).pathname === '/watch');
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      counts: { shortsLinks: shorts.length, regularVideoLinks: regular.length },
      shorts: shorts.slice(0, 60).map(describeLink),
      regular: regular.slice(0, 8).map(describeLink),
      channelTabs: [
        ...links.filter(link => /\/@[^/]+\/(shorts|videos)(?:[?#]|$)/.test(link.href)).map(describeLink),
        ...[...document.querySelectorAll('[role="tab"]')]
          .map(tab => ({ ...describe(tab), text: tab.textContent.trim() })),
      ],
    };
  });
}
