const municipality = document.getElementById('municipality');
const workplace = document.getElementById('workplace');
const team = document.getElementById('team');
const button = document.getElementById('openTeam');
const message = document.getElementById('finderMessage');

municipality.addEventListener('change', () => {
  workplace.innerHTML = municipality.value === 'halsnaes'
    ? '<option value="">Vælg arbejdsplads</option><option value="trekloeveret">Center for Botilbud og Beskæftigelse – Trekløveret</option>'
    : '<option value="">Vælg arbejdsplads</option>';
  workplace.disabled = !municipality.value;
  team.innerHTML = '<option value="">Vælg team</option>';
  team.disabled = true;
  button.disabled = true;
  message.textContent = '';
});

workplace.addEventListener('change', () => {
  team.innerHTML = workplace.value === 'trekloeveret'
    ? '<option value="">Vælg team</option><option value="team-1">Team 1 – ikke oprettet endnu</option><option value="team-2">Team 2</option><option value="team-3">Team 3 – ikke oprettet endnu</option><option value="opgangen">Opgangen – ikke oprettet endnu</option>'
    : '<option value="">Vælg team</option>';
  team.disabled = !workplace.value;
  button.disabled = true;
  message.textContent = '';
});

team.addEventListener('change', () => {
  const ready = team.value === 'team-2';
  button.disabled = !ready;
  message.textContent = team.value && !ready ? 'Dette team er endnu ikke oprettet i VisuPlanner.' : '';
});

document.getElementById('teamFinder').addEventListener('submit', event => {
  event.preventDefault();
  if (team.value === 'team-2') window.location.href = '/team-2';
});
