const form = document.getElementById('activateForm');
const statusEl = document.getElementById('activateStatus');
const token = new URLSearchParams(location.search).get('token') || '';
let invitation = null;

async function check() {
  try {
    const response = await fetch(`/api/activate-team?token=${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    invitation = data;
    document.getElementById('teamName').textContent = data.teamName;
    const reset = data.purpose === 'password_reset';
    document.getElementById('activationHeading').textContent = reset ? 'Vælg en ny personalekode' : 'Vælg jeres egne koder';
    document.getElementById('activationIntro').textContent = reset ? 'Linket kan kun bruges én gang og ændrer kun personalekoden.' : 'Koderne opbevares sikkert og kan ses af jeres udpegede kundeadministratorer.';
    document.getElementById('viewerCodeFields').hidden = reset;
    document.querySelectorAll('#viewerCodeFields input').forEach(input => { input.required = !reset; });
    document.getElementById('agreementFields').hidden = reset || !data.needsAcceptance;
    document.querySelectorAll('#agreementFields input').forEach(input => { input.required = !reset && data.needsAcceptance; });
    form.querySelector('button').textContent = reset ? 'Gem ny personalekode' : 'Aktivér tavlen';
    form.hidden = false;
  } catch (error) {
    statusEl.textContent = error.message;
    form.hidden = false;
    form.querySelectorAll('input,button').forEach(element => { element.disabled = true; });
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (values.editorPassword !== values.editorRepeat) return statusEl.textContent = 'Personalekoderne er ikke ens.';
  if (invitation?.purpose !== 'password_reset' && values.viewerPassword !== values.viewerRepeat) return statusEl.textContent = 'Tavlekoderne er ikke ens.';
  const button = event.submitter;
  button.disabled = true;
  button.textContent = 'Gemmer…';
  try {
    const response = await fetch('/api/activate-team', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        editorPassword: values.editorPassword,
        viewerPassword: values.viewerPassword,
        acceptedByName: values.acceptedByName,
        acceptedAgreement: values.acceptedAgreement === 'on'
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    statusEl.className = 'finder-message success-message';
    statusEl.textContent = data.reset ? 'Personalekoden er ændret. Du sendes videre…' : 'Tavlen er aktiveret. Jeres 14 dages prøveperiode starter nu.';
    setTimeout(() => { location.href = `/${data.slug}`; }, 1400);
  } catch (error) {
    statusEl.className = 'finder-message error-message';
    statusEl.textContent = error.message;
    button.disabled = false;
    button.textContent = invitation?.purpose === 'password_reset' ? 'Gem ny personalekode' : 'Aktivér tavlen';
  }
});

check();
