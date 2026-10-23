/* Samal Dental Care — gallery lightbox.
   Each photograph is a plain link to the full-size image, so without this
   script it still opens. With it, the image opens in a modal <dialog>:
   Escape closes (native), arrow keys and the buttons step through, and focus
   returns to the photograph that was opened. */
(function () {
  'use strict';
  var dialog = document.querySelector('[data-lightbox-dialog]');
  var links = Array.prototype.slice.call(document.querySelectorAll('a[data-lightbox]'));
  if (!dialog || !links.length || typeof dialog.showModal !== 'function') return;

  var img = dialog.querySelector('.lightbox__img');
  var caption = dialog.querySelector('.lightbox__caption');
  var prev = dialog.querySelector('[data-lightbox-prev]');
  var next = dialog.querySelector('[data-lightbox-next]');
  var current = 0;
  var opener = null;

  if (links.length < 2) { prev.hidden = true; next.hidden = true; }

  function show(i) {
    current = (i + links.length) % links.length;
    var a = links[current];
    var thumb = a.querySelector('img');
    img.src = a.href;
    img.alt = thumb ? thumb.alt : '';
    caption.textContent = (a.getAttribute('data-caption') || '') +
      (links.length > 1 ? '  ·  ' + (current + 1) + ' of ' + links.length : '');
  }

  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      opener = a;
      show(i);
      dialog.showModal();
      document.documentElement.classList.add('has-lightbox');
    });
  });

  prev.addEventListener('click', function () { show(current - 1); });
  next.addEventListener('click', function () { show(current + 1); });
  dialog.querySelector('[data-lightbox-close]').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
  });
  /* A click on the dimmed backdrop (the dialog itself, not its contents). */
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', function () {
    document.documentElement.classList.remove('has-lightbox');
    img.removeAttribute('src');
    if (opener) opener.focus();
  });
})();
