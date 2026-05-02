// ============================================================
// Dice roller
// ============================================================

function rollDice() {
  const count = Math.min(10, Math.max(1, parseInt(document.getElementById('diceCount').value) || 1));
  const sides = parseInt(document.getElementById('diceType').value);

  // Pre-generate deterministic results
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }

  // Send over WebSocket — the DO broadcasts to ALL clients (including sender)
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'roll_dice', count, sides, results }));
  } else {
    // Offline fallback
    showDiceRoll(count, sides, results);
  }
}

function showDiceRoll(count, sides, results) {
  const display = document.getElementById('diceDisplay');
  const resultModal = document.getElementById('diceResult');

  display.innerHTML = '';
  resultModal.classList.remove('open');

  const duration = 1100;
  let completed = 0;

  for (let i = 0; i < count; i++) {
    const dieEl = document.createElement('div');
    dieEl.className = 'die rolling';
    dieEl.dataset.sides = sides;
    dieEl.textContent = '?';
    display.appendChild(dieEl);

    const final = results[i];
    const startTime = Date.now();
    const interval = setInterval(() => {
      dieEl.textContent = Math.floor(Math.random() * sides) + 1;

      if (Date.now() - startTime >= duration) {
        clearInterval(interval);
        dieEl.textContent = final;
        dieEl.classList.remove('rolling');

        if (final === sides) dieEl.classList.add('nat20');
        else if (final === 1) dieEl.classList.add('nat1');

        completed++;

        if (completed === count) {
          const total = results.reduce((a, b) => a + b, 0);
          document.getElementById('diceTotal').textContent = total;
          document.getElementById('diceBreakdown').textContent =
            count > 1 ? `${results.join(' + ')} = ${total}` : '';
          resultModal.classList.add('open');
          setTimeout(() => resultModal.classList.remove('open'), 2200);
        }
      }
    }, 45);
  }
}