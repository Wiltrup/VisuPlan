const token = new URLSearchParams(location.search).get('token') || '';
const form = document.getElementById('adminActivationForm');
const statusNode = document.getElementById('adminActivationStatus');
let invitation = null;

async function checkInvitation() {
  try {
    const response = await fetch(`/api/customer-admin?flow=access&token=${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    invitation = data;
    document.getElementById('adminActivationHeading').textContent = data.purpose === 'password_reset' ? 'Vælg en ny adgangskode' : `Bliv administrator for ${data.customerName}`;
    document.getElementById('adminActivationIntro').textContent = data.purpose === 'password_reset' ? 'Linket kan kun bruges én gang og udløber efter én time.' : 'Opret dit personlige login med din arbejdsmail og en adgangskode, som kun du kender.';
    document.getElementById('adminActivationName').value = data.name;
    document.getElementById('adminActivationEmail').value = data.email;
    form.hidden = false;
  } catch (error) {
    document.getElementById('adminActivationHeading').textContent = 'Linket kan ikke bruges';
    document.getElementById('adminActivationIntro').textContent = error.message;
  }
}

form.onsubmit = async event => {
  event.preventDefault(); const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.repeat) { statusNode.textContent = 'Adgangskoderne er ikke ens.'; statusNode.className = 'form-message error'; return; }
  const button = event.submitter; button.disabled = true; button.textContent = 'Gemmer…';
  try {
    const response = await fetch('/api/customer-admin?flow=access', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ token, password:values.password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    statusNode.className = 'form-message';
    statusNode.textContent = data.reset ? 'Adgangskoden er ændret. Du sendes til login…' : 'Dit administratorlogin er oprettet. Du sendes til login…';
    setTimeout(() => { location.href = `/kundeadmin?email=${encodeURIComponent(invitation.email)}`; }, 1200);
  } catch (error) { statusNode.className = 'form-message error'; statusNode.textContent = error.message; button.disabled = false; button.textContent = 'Gem og fortsæt'; }
};

checkInvitation();
