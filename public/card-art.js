export const ranks = ['Initiate', 'Apprentice', 'Rune Student', 'Spellkeeper', 'Conjurer', 'Enchanter', 'Sorcerer', 'Seer', 'Spellmaster', 'High Mage', 'Archmage', 'Oracle', 'Celestial', 'Ascendant', 'Grand Wizard'];

// Higher ranks gain engraved robes, staffs, orbiting runes, halos, and a crown.
// All illustrations inherit the card's suit color and scale without image assets.
export function wizardArt(value) {
  const tier = Math.ceil(value / 3);
  const stars = Array.from({ length: value }, (_, i) => {
    const angle = (i / value) * Math.PI * 2 - Math.PI / 2;
    const x = (60 + Math.cos(angle) * 47).toFixed(1);
    const y = (75 + Math.sin(angle) * 61).toFixed(1);
    return `<path d="M${x} ${Number(y) - 2.7}v5.4M${Number(x) - 2.7} ${y}h5.4" class="art-spark"/>`;
  }).join('');
  const halo = tier >= 3 ? `<ellipse cx="60" cy="66" rx="${28 + tier * 2}" ry="${37 + tier * 2}" class="art-halo"/>${tier >= 4 ? '<ellipse cx="60" cy="66" rx="47" ry="58" class="art-halo outer-halo"/><path d="M13 66h94M60 8v116" class="art-axis"/>' : ''}` : '';
  const ornaments = tier >= 2 ? `<path d="M35 107 60 122 84 107M39 125l21 12 18-12M51 96l9 7 9-7" class="art-embroidery"/>${tier >= 4 ? '<path d="m32 110-5 17 12 5M88 110l5 17-12 5M60 112v34M51 119l9-7 9 7-9 9Z" class="art-embroidery"/>' : ''}` : '';
  const crown = tier === 5 ? '<path d="m40 28 5-13 9 7 6-15 7 15 9-7 4 13-20 8Z" class="art-crown"/><path d="m60 1 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" class="art-crown"/>' : '';
  const wings = value >= 13 ? '<path d="M33 88 9 68l6 27 20 11M86 88l25-20-6 27-20 11M29 94 15 82M92 94l13-12" class="art-wings"/>' : '';
  const staff = tier >= 2 ? `<path d="m98 56-9 89" class="art-staff"/><circle cx="99" cy="49" r="${tier + 3}" class="art-orb"/>${tier >= 4 ? '<path d="m90 43 9-10 9 10-9 14ZM85 49h28M99 26v10" class="art-spell"/>' : ''}` : '';
  const spell = tier >= 3 ? `<circle cx="22" cy="98" r="${tier + 4}" class="art-orb"/><path d="M22 83v30M7 98h30m-24-9 18 18m-18 0 18-18" class="art-spell"/>` : '';
  const beardLength = 85 + tier * 4;
  return `<svg class="wizard-art" viewBox="0 0 120 158" aria-hidden="true" focusable="false">${halo}${stars}${wings}<path d="M44 88 27 103 19 148h82l-8-44-18-16Z" class="art-robe"/><path d="m44 91 16 57 17-57" class="art-fold"/>${ornaments}<path d="M43 58c-3 18 0 34 17 40 17-6 20-22 17-40Z" class="art-face"/><path d="M47 79 60 ${beardLength} 74 79l-8 6-6-2-6 3Z" class="art-beard"/><path d="m47 71 8-1m10 0 8 1" class="art-eyes"/><path d="m58 72-2 8h7" class="art-nose"/><path d="M33 59 56 ${24 - tier}l14 12 16 25Z" class="art-hat"/><path d="M30 59q30-12 60 0l-3 7H33Z" class="art-brim"/><path d="m59 38 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" class="art-hat-star"/>${staff}${spell}${crown}</svg>`;
}
