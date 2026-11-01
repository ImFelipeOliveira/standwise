(() => {
  const copy = document.getElementById('copy');
  const cmd = document.getElementById('cmd');
  if (copy && cmd) {
    const label = copy.textContent;
    const done = copy.dataset.done || label;
    const selectCmd = () => {
      const range = document.createRange();
      range.selectNodeContents(cmd);
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    copy.addEventListener('click', () => {
      const text = cmd.dataset.copy || '';
      const confirm = () => {
        copy.textContent = done;
        setTimeout(() => {
          copy.textContent = label;
        }, 1600);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(confirm, selectCmd);
      } else {
        selectCmd();
      }
    });
  }

  const stage = document.querySelector('.stage');
  const replay = document.getElementById('replay');
  if (!stage || !replay || !window.matchMedia) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let timer = 0;
  const play = () => {
    stage.classList.remove('play');
    void stage.offsetWidth;
    stage.classList.add('play');
    replay.hidden = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      replay.hidden = false;
    }, 5400);
  };
  replay.addEventListener('click', play);
  play();
})();
