// Beregn én kalendermåned uden JavaScripts overløb ved månedens slutning.
function oneCalendarMonthAfter(value) {
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) throw new TypeError('Ugyldig startdato for prøveperiode.');
  const end = new Date(start);
  const startDay = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(startDay, lastDay));
  return end.toISOString();
}

module.exports = { oneCalendarMonthAfter };
