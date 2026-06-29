// ── FLOW URLS & TOKEN ────────────────────────────────────────────
const FLOW_A_URL = 'https://default1ed3f0787b424ba88bcda52b653e0f.e8.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/c5bbe86751024ddaa3079a64820296f4/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=OywwGctK8-GHmWSfosyWxz5C9SMjZkJLrYDt21bZ2TY';

const FLOW_B_URL = 'https://default1ed3f0787b424ba88bcda52b653e0f.e8.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/cfa521e3131c4cccb57f54ccc64d53b6/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=QcJxpBHonJgn3QtMpj7SkOluRiuJmiRYLLOPrzYZJVQ';

const TOKEN = 'vsl-survey-x7k29mQ4';

// ── FETCH CONFIG FROM FLOW A ─────────────────────────────────────
async function fetchConfig() {
  try {
    const response = await fetch(FLOW_A_URL, {
      method: 'POST',
      headers: {
        'x-survey-token': TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn('Flow A returned:', response.status);
      return;
    }

    const data = await response.json();

    // Save question and config to IndexedDB
    await saveToDB('config', 'question', data.question);
    await saveToDB('config', 'config',   data.config);
    await saveToDB('config', 'last_fetch', new Date().toISOString());

    // Re-render with fresh data
    renderQuestion(data.question);
    renderRanks(data.config);

    console.log('Config fetched and cached successfully');

  } catch (err) {
    console.warn('Flow A fetch failed — using cached data:', err.message);
  }
}

// ── POST RESPONSE TO FLOW B ──────────────────────────────────────
async function postResponse(response) {
  const res = await fetch(FLOW_B_URL, {
    method: 'POST',
    headers: {
      'x-survey-token': TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(response)
  });

  if (!res.ok) {
    throw new Error(`Flow B returned ${res.status}`);
  }

  return true;
}

// ── SYNC QUEUE ────────────────────────────────────────────────────
async function syncQueue() {
  if (!navigator.onLine) return;

  try {
    const queued = await getAllQueued();

    if (queued.length === 0) return;

    console.log(`Syncing ${queued.length} queued response(s)...`);

    for (const item of queued) {
      try {
        // Add synced_at timestamp just before sending
        const payload = {
          ...item,
          synced_at: new Date().toISOString()
        };

        // Remove the IndexedDB id field before posting
        delete payload.id;

        await postResponse(payload);
        await removeFromQueue(item.id);

        console.log('Response synced:', item.id);

      } catch (err) {
        console.warn('Failed to sync item', item.id, '— will retry later:', err.message);
        // Stop trying if one fails — likely a connectivity issue
        break;
      }
    }
  } catch (err) {
    console.warn('Sync queue error:', err.message);
  }
}
