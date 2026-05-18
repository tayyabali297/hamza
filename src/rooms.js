// Personal context lives in context.local.js (gitignored).
// See context.js for the template to fill in.
import { BASE } from './context.local.js';

export const CATS = [
  { id: 'general',   label: 'Everything', sub: 'Life, decisions, anything on your mind' },
  { id: 'spiritual', label: 'Spiritual',  sub: 'Deen, Allah, Quran, salah, purpose' },
  { id: 'financial', label: 'Financial',  sub: 'Money, halal finance, budgeting, business' },
  { id: 'emotional', label: 'Emotional',  sub: 'Feelings, relationships, anxiety, stress' },
  { id: 'college',   label: 'College',    sub: 'UCD, exams, modules, study strategy' },
  { id: 'building',  label: 'Building',   sub: 'Glao, freelance, Pakistani Society, execution' },
];

// These rooms auto-enable Deep mode (Sonnet)
export const DEEP_ROOMS = ['emotional', 'spiritual'];

export const OPENERS = {
  general:   'As-salamu alaykum. What is on your mind?',
  spiritual: 'Your spiritual space. What is on your heart?',
  financial: 'Money talk. Halal lens first. What are we looking at?',
  emotional: 'Your space to process. What is going on?',
  college:   'College space. Exams are close. What do you need?',
  building:  'Building space. What are you actually doing versus what you said you would?',
};

// Room-specific additions to the base system prompt
const ADDONS = {
  general:   '',
  spiritual: ' ROOM: Spiritual. Bring Quran, hadith, and Islamic wisdom naturally. Reverent but grounded. Never preachy.',
  financial: ' ROOM: Financial. Apply halal filter before anything else. No riba, ever. Numbers-first, long-term thinking.',
  emotional: ' ROOM: Emotional. Listen first. Reflect before advising. Validate the feeling, not necessarily the story. Do not rush to fix.',
  college:   ' ROOM: College. Practical, structured, Socratic. Do not let him underestimate exam proximity. Ask questions to lead him to answers.',
  building:  ' ROOM: Building. Relentless accountability. Ask specifically: did you do the outreach? How many? What changed since last time? He under-executes. Name it.',
};

export function getSys(catId, notes) {
  let s = BASE + (ADDONS[catId] || '');
  if (notes && notes.trim()) s += ' MEMORY NOTES: ' + notes.slice(0, 300);
  return s;
}

export function buildMessages(userMessages, sys) {
  return [
    { role: 'user',      content: 'Instructions: ' + sys },
    { role: 'assistant', content: 'Understood. I am Hamza.' },
    ...userMessages,
  ];
}
