import { LAND_PURPOSES, normalizeLandCriteria } from '../acquisition/session.js';

function field(labelText, input, hint = '') {
  const group = document.createElement('label');
  group.className = 'ldos-criteria-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  group.append(label, input);
  if (hint) {
    const small = document.createElement('small');
    small.textContent = hint;
    group.append(small);
  }
  return group;
}

function inputFor(type, options = {}) {
  const input = document.createElement('input');
  input.type = type;
  for (const [name, value] of Object.entries(options)) input[name] = value;
  return input;
}

/** First-run intake before the map/application is started. No network writes. */
export function showLandDiscoveryGate() {
  if (document.getElementById('land-discovery-gate')) {
    throw new Error('Land discovery gate is already mounted.');
  }
  const shell = document.createElement('section');
  shell.id = 'land-discovery-gate';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-labelledby', 'ldos-welcome-heading');
  shell.setAttribute('aria-describedby', 'ldos-welcome-description');

  const card = document.createElement('div');
  card.className = 'ldos-welcome-card';
  const brand = document.createElement('div');
  brand.className = 'ldos-welcome-brand';
  brand.textContent = 'LAND DEVELOPMENT  /  OPERATING SYSTEM';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'ldos-welcome-eyebrow';
  eyebrow.textContent = 'PERSONALIZED WORKSPACE · TEXAS PREVIEW';
  const heading = document.createElement('h1');
  heading.id = 'ldos-welcome-heading';
  heading.textContent = 'Find land that fits your plan.';
  const description = document.createElement('p');
  description.id = 'ldos-welcome-description';
  description.textContent = 'Tell us what you are looking for. Your criteria will organize this session and help you review potential acquisitions without hiding parcels with missing data.';

  const form = document.createElement('form');
  form.className = 'ldos-welcome-form';
  form.noValidate = true;

  const purpose = document.createElement('select');
  purpose.name = 'purpose';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select a purpose (optional)';
  purpose.append(blank);
  for (const name of LAND_PURPOSES) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    purpose.append(option);
  }
  const budget = inputFor('number', {
    name: 'budgetMax', min: '0', step: 'any',
    placeholder: 'e.g. 500000', inputMode: 'decimal',
  });
  const zip = inputFor('text', {
    name: 'zip', placeholder: 'Texas ZIP (optional)',
    maxLength: 5, inputMode: 'numeric',
  });
  const min = inputFor('number', {
    name: 'acresMin', min: '0', step: 'any', placeholder: 'Minimum',
  });
  const max = inputFor('number', {
    name: 'acresMax', min: '0', step: 'any', placeholder: 'Maximum',
  });

  const row = document.createElement('div');
  row.className = 'ldos-criteria-grid';
  row.append(
    field('Maximum purchase budget ($)', budget, 'Asking prices are not yet verified by the GIS map.'),
    field('Preferred ZIP code', zip, 'A preference, not a geographic or zoning clearance.'),
    field('Minimum acres', min),
    field('Maximum acres', max),
  );
  form.append(field('What do you need the land for?', purpose), row);

  const error = document.createElement('p');
  error.className = 'ldos-criteria-error';
  error.setAttribute('role', 'alert');
  error.setAttribute('aria-live', 'assertive');

  const note = document.createElement('p');
  note.className = 'ldos-welcome-note';
  note.textContent = 'Preview: criteria and acquisition shortlist are held only in this browser tab. They are not saved to a customer account. Land use, prices, ownership and buildability require independent verification.';

  const footer = document.createElement('div');
  footer.className = 'ldos-welcome-actions';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'ldos-welcome-skip';
  skip.textContent = 'Explore without criteria';
  const begin = document.createElement('button');
  begin.type = 'submit';
  begin.className = 'ldos-welcome-continue';
  begin.textContent = 'Enter workspace →';
  footer.append(skip, begin);
  form.append(error, footer);
  card.append(brand, eyebrow, heading, description, form, note);
  shell.append(card);
  document.body.append(shell);
  document.body.dataset.landEntry = 'pending';

  return new Promise((resolve) => {
    let finished = false;
    const complete = (criteria) => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey);
      shell.remove();
      document.body.dataset.landEntry = 'complete';
      resolve(criteria);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') complete(null);
    };
    document.addEventListener('keydown', onKey);
    skip.addEventListener('click', () => complete(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const criteria = normalizeLandCriteria({
          purpose: purpose.value, zip: zip.value, budgetMax: budget.value,
          acresMin: min.value, acresMax: max.value,
        });
        error.textContent = '';
        complete(criteria);
      } catch (cause) {
        error.textContent = cause.message;
      }
    });
    purpose.focus();
  });
}
