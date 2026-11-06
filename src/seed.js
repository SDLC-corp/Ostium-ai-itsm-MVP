// Reference data + deterministic demo data for the Ostium ITSM MVP.
import { rng, DAY, HOUR, MIN, iso } from './util.js';
import { addBusinessMinutes } from './sla.js';

export const CATEGORIES = {
  Network: { group: 'Network Operations', department: 'IT' },
  'Access & Identity': { group: 'Identity & Access', department: 'IT' },
  Hardware: { group: 'End-User Computing', department: 'IT' },
  Software: { group: 'Service Desk', department: 'IT' },
  'Email & Collaboration': { group: 'Messaging & Collaboration', department: 'IT' },
  Security: { group: 'Security Operations', department: 'IT' },
  HR: { group: 'HR Services', department: 'HR' },
  Facilities: { group: 'Facilities Services', department: 'Facilities' },
  Finance: { group: 'Finance Operations', department: 'Finance' },
};

export const TECHNICIANS = [
  { id: 'tech-01', name: 'Priya Raman', group: 'Network Operations', skills: ['Network', 'Security'] },
  { id: 'tech-02', name: 'Marcus Lee', group: 'Network Operations', skills: ['Network'] },
  { id: 'tech-03', name: 'Elena Ortiz', group: 'Identity & Access', skills: ['Access & Identity', 'Security'] },
  { id: 'tech-04', name: 'Sam Okafor', group: 'Identity & Access', skills: ['Access & Identity'] },
  { id: 'tech-05', name: 'Jordan Blake', group: 'End-User Computing', skills: ['Hardware', 'Software'] },
  { id: 'tech-06', name: 'Aisha Khan', group: 'End-User Computing', skills: ['Hardware'] },
  { id: 'tech-07', name: 'Tom Nguyen', group: 'Service Desk', skills: ['Software', 'Email & Collaboration'] },
  { id: 'tech-08', name: 'Grace Miller', group: 'Messaging & Collaboration', skills: ['Email & Collaboration'] },
  { id: 'tech-09', name: 'Victor Hale', group: 'Security Operations', skills: ['Security', 'Network'] },
  { id: 'tech-10', name: 'Nadia Petrova', group: 'HR Services', skills: ['HR'] },
  { id: 'tech-11', name: 'Luis Romero', group: 'Facilities Services', skills: ['Facilities'] },
  { id: 'tech-12', name: 'Hannah Cho', group: 'Finance Operations', skills: ['Finance'] },
];

export const REQUESTERS = [
  { name: 'Dana Whitfield', email: 'dana.whitfield@county.example', department: 'Finance' },
  { name: 'Robert Chen', email: 'robert.chen@county.example', department: 'Public Health' },
  { name: 'Maria Gonzalez', email: 'maria.gonzalez@county.example', department: 'Courts' },
  { name: 'Kevin Brooks', email: 'kevin.brooks@county.example', department: "Sheriff's Office" },
  { name: 'Linda Park', email: 'linda.park@county.example', department: 'Parks & Recreation' },
  { name: 'Omar Haddad', email: 'omar.haddad@county.example', department: 'Libraries' },
  { name: 'Emily Stone', email: 'emily.stone@county.example', department: 'Human Resources' },
  { name: 'Chris Walker', email: 'chris.walker@county.example', department: 'Finance' },
];

// Labelled examples — used both to train the triage model and to generate demo tickets.
// [category, title, description, impact(1 high..3 low), urgency(1..3)]
export const EXAMPLES = [
  ['Network', 'VPN down for Finance during month-end close', 'Nobody in finance can connect to the VPN, month-end close is blocked', 1, 1],
  ['Network', 'Wi-Fi keeps dropping in conference room', 'Wireless connection drops every few minutes on floor 3', 2, 2],
  ['Network', 'Slow network at branch library', 'Internet is extremely slow at the library branch, pages time out', 2, 2],
  ['Network', 'Cannot reach intranet site', 'DNS error when loading the intranet from the office network', 2, 2],
  ['Network', 'Firewall rule request for vendor', 'Need port 443 opened on the firewall for the vendor integration', 3, 3],
  ['Network', 'Network switch outage in courthouse', 'All workstations on the 2nd floor lost network, switch appears down', 1, 1],
  ['Access & Identity', 'Password reset required', 'Locked out of my account after too many attempts, need a password reset', 3, 2],
  ['Access & Identity', 'MFA not prompting on new phone', 'Got a new phone and the authenticator MFA prompt no longer arrives', 3, 2],
  ['Access & Identity', 'Access to shared drive', 'Need read access to the Finance shared drive folder for audit', 3, 3],
  ['Access & Identity', 'SSO login failing for HR portal', 'Single sign-on to the HR portal returns an error for my team', 2, 2],
  ['Access & Identity', 'Account locked', 'My Active Directory account is locked, cannot log in to windows', 3, 1],
  ['Hardware', 'Laptop screen cracked', 'Dropped my laptop and the display is cracked, need a replacement', 3, 2],
  ['Hardware', 'Printer jam on 4th floor', 'The printer on the fourth floor keeps jamming and shows an error', 3, 3],
  ['Hardware', 'Docking station not detecting monitors', 'Dock does not detect my two external monitors', 3, 3],
  ['Hardware', 'Laptop battery will not charge', 'Battery stuck at 0 percent, laptop shuts off when unplugged', 3, 2],
  ['Hardware', 'Desk phone has no dial tone', 'Desk phone handset has no dial tone since this morning', 3, 2],
  ['Software', 'Excel crashes when opening large workbook', 'Excel freezes and crashes opening the budget workbook', 3, 2],
  ['Software', 'Install Adobe Acrobat Pro', 'Need Adobe Acrobat installed to edit PDF forms', 3, 3],
  ['Software', 'ERP application error on save', 'Getting an error when saving purchase orders in the ERP application', 2, 2],
  ['Software', 'Software update failed', 'Windows update failed and keeps rolling back on restart', 3, 3],
  ['Software', 'Case management app very slow', 'The court case management application takes minutes to load', 2, 2],
  ['Email & Collaboration', 'Outlook not syncing email', 'Outlook stopped syncing, no new email since yesterday', 3, 2],
  ['Email & Collaboration', 'Teams meeting audio issue', 'Microsoft Teams calls have no audio on my headset', 3, 2],
  ['Email & Collaboration', 'Shared mailbox access', 'Please add me to the public health shared mailbox', 3, 3],
  ['Email & Collaboration', 'Email bouncing to external partner', 'Emails to the state agency bounce back with an undeliverable error', 2, 2],
  ['Email & Collaboration', 'SharePoint site permissions', 'Cannot edit documents on the SharePoint team site', 3, 3],
  ['Security', 'Suspicious phishing email received', 'Received a phishing email asking for credentials, I clicked the link', 2, 1],
  ['Security', 'Possible malware on workstation', 'Antivirus alert detected malware, computer acting strange with popups', 2, 1],
  ['Security', 'Lost laptop with sensitive data', 'Laptop with case files was stolen from my car, need it wiped', 2, 1],
  ['Security', 'Unusual login alert', 'Received an alert about a sign-in from another country', 2, 1],
  ['HR', 'New hire onboarding next Monday', 'New employee starts Monday, needs onboarding, accounts and equipment', 3, 2],
  ['HR', 'Question about leave balance', 'My PTO leave balance looks incorrect on my paystub', 3, 3],
  ['HR', 'Benefits enrollment change', 'Need to update benefits enrollment after a life event', 3, 3],
  ['HR', 'Employee offboarding', 'Employee leaving Friday, please process offboarding and revoke access', 3, 2],
  ['HR', 'Payroll direct deposit update', 'Update my direct deposit bank account for payroll', 3, 3],
  ['Facilities', 'Air conditioning not working', 'HVAC is out in the records room, temperature is very high', 2, 2],
  ['Facilities', 'Office move request', 'Team relocating to building B, need desks, phones and keys', 3, 3],
  ['Facilities', 'Broken door badge reader', 'The badge reader on the east entrance does not open the door', 2, 2],
  ['Facilities', 'Water leak in ceiling', 'Water leaking from the ceiling tiles above the server closet', 1, 1],
  ['Facilities', 'Light fixtures out in parking garage', 'Several lights are out in the parking garage level 2', 3, 3],
  ['Finance', 'Purchase order approval stuck', 'Purchase order has been pending approval for two weeks', 3, 2],
  ['Finance', 'Expense reimbursement question', 'Expense report reimbursement has not been paid yet', 3, 3],
  ['Finance', 'Vendor invoice mismatch', 'Invoice amount does not match the purchase order from the vendor', 3, 2],
  ['Finance', 'Budget transfer request', 'Need a budget transfer between cost centers for Q4', 3, 3],
  ['Finance', 'Chargeback report for shared services', 'Need the monthly chargeback report for IT shared services', 3, 3],
];

export const SLA_POLICIES = [
  { id: 'P1', name: 'Critical', responseMinutes: 15, resolutionMinutes: 240, calendarId: '24x7' },
  { id: 'P2', name: 'High', responseMinutes: 30, resolutionMinutes: 480, calendarId: 'us-business' },
  { id: 'P3', name: 'Medium', responseMinutes: 240, resolutionMinutes: 1620, calendarId: 'us-business' },
  { id: 'P4', name: 'Low', responseMinutes: 480, resolutionMinutes: 2700, calendarId: 'us-business' },
];

const WEEKDAY_HOURS = { 1: [8, 17], 2: [8, 17], 3: [8, 17], 4: [8, 17], 5: [8, 17] };

export const CALENDARS = [
  { id: '24x7', name: '24 x 7', always: true },
  {
    id: 'us-business', name: 'US Eastern business hours (Mon–Fri 08:00–17:00)', timeZone: 'America/New_York', hours: WEEKDAY_HOURS,
    holidays: ['2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-07-05'],
  },
];

export const KB_ARTICLES = [
  ['Connect to the VPN and fix common errors', 'Network', 'employee', 'Open the VPN client, choose the "County-Main" gateway and sign in with SSO. Error 809: restart the client and check that your home router allows IPsec. Error "certificate expired": run Software Center > "VPN Certificate Refresh". If the whole department cannot connect, check the status banner — it is probably an outage, do not open duplicate tickets.'],
  ['Reset your password with self-service', 'Access & Identity', 'employee', 'Go to the self-service password portal, verify with MFA, choose a new passphrase of 14+ characters. Accounts unlock automatically after 15 minutes. If MFA is not registered, contact the Service Desk.'],
  ['Re-register MFA on a new phone', 'Access & Identity', 'employee', 'Sign in to the security info page from a trusted computer, remove the old device, add the authenticator app on the new phone and scan the QR code. Keep the old phone until the new prompt works.'],
  ['Fix Outlook email not syncing or receiving', 'Email & Collaboration', 'employee', 'Check you are online, then File > Account Settings > Repair. Clear the offline cache (OST) if repair fails. Large mailboxes over quota stop syncing — archive old items.'],
  ['Teams audio troubleshooting', 'Email & Collaboration', 'employee', 'In Teams Settings > Devices select the right headset, run a test call. Unplug and reconnect the headset, update the device driver. Close other apps that use the microphone.'],
  ['Report a phishing email', 'Security', 'employee', 'Use the "Report Phishing" button in Outlook. Do not forward the email. If you clicked a link or entered your password, reset your password immediately and open a Security ticket marked urgent.'],
  ['Printer jams and error codes', 'Hardware', 'employee', 'Open tray 2 and the rear door, remove jammed paper gently. Error 13.A: fuser jam — power cycle the printer. If jams repeat, the rollers need replacement; open a ticket with the asset tag.'],
  ['Request new software', 'Software', 'employee', 'Most approved software is available in Software Center. For licensed products (Adobe Acrobat Pro, Visio, Project), submit the Software License Request from the Service Catalog; your manager approves it.'],
  ['Laptop replacement policy', 'Hardware', 'internal', 'Laptops are replaced on a 4-year cycle or when repair cost exceeds 50% of replacement. Accidental damage requires a manager-approved Laptop Replacement request; costs above $1,500 need Finance approval.'],
  ['Major incident communication runbook', 'Network', 'internal', 'Declare a major incident when a service outage affects a department or more. Open a bridge, link related tickets as children, publish a status banner, send updates every 30 minutes, and run a post-incident review within 5 business days.'],
  ['How to read your chargeback statement', 'Finance', 'public', 'Each department receives a monthly chargeback statement for shared services: tickets handled, service catalog fulfilments and license costs allocated by headcount.'],
  ['Onboarding checklist for managers', 'HR', 'employee', 'Submit the New Hire Onboarding request 5 business days before the start date. Ostium creates the accounts, assigns a laptop, licenses Microsoft 365 and books facilities setup automatically after your approval.'],
];

export const CATALOG = [
  {
    id: 'cat-onboarding', name: 'New Hire Onboarding', department: 'HR', category: 'HR', icon: '🧑‍💼',
    description: 'Accounts, laptop, Microsoft 365 license and desk setup for a new employee — one request.',
    fields: [
      { key: 'employeeName', label: 'Employee name', type: 'text', required: true },
      { key: 'startDate', label: 'Start date', type: 'date', required: true },
      { key: 'role', label: 'Job title', type: 'text', required: true },
      { key: 'needsLaptop', label: 'Needs a laptop', type: 'checkbox', default: true },
    ],
    workflow: [
      { id: 'mgr', name: 'Manager approval', type: 'approval', group: 'Requester manager' },
      { id: 'ad', name: 'Create identity account (Entra ID / AD)', type: 'task', group: 'Identity & Access', dependsOn: ['mgr'] },
      { id: 'laptop', name: 'Assign and image laptop', type: 'task', group: 'End-User Computing', dependsOn: ['mgr'], condition: { field: 'needsLaptop', op: 'eq', value: true } },
      { id: 'm365', name: 'Assign Microsoft 365 license', type: 'task', group: 'Messaging & Collaboration', dependsOn: ['ad'] },
      { id: 'desk', name: 'Facilities desk and badge setup', type: 'task', group: 'Facilities Services', dependsOn: ['mgr'] },
      { id: 'welcome', name: 'Send welcome pack to manager', type: 'notify', group: 'HR Services', dependsOn: ['ad', 'laptop', 'm365', 'desk'] },
    ],
  },
  {
    id: 'cat-laptop', name: 'Laptop Replacement', department: 'IT', category: 'Hardware', icon: '💻',
    description: 'Replace a damaged or end-of-life laptop. Costs above $1,500 route to Finance.',
    fields: [
      { key: 'assetTag', label: 'Current asset tag', type: 'text', required: true },
      { key: 'reason', label: 'Reason', type: 'select', options: ['Damaged', 'End of life', 'Performance'], required: true },
      { key: 'estimatedCost', label: 'Estimated cost (USD)', type: 'number', default: 1200 },
    ],
    workflow: [
      { id: 'mgr', name: 'Manager approval', type: 'approval', group: 'Requester manager' },
      { id: 'fin', name: 'Finance approval (> $1,500)', type: 'approval', group: 'Finance Operations', dependsOn: ['mgr'], condition: { field: 'estimatedCost', op: 'gt', value: 1500 } },
      { id: 'procure', name: 'Procure / allocate from stock', type: 'task', group: 'End-User Computing', dependsOn: ['fin'] },
      { id: 'migrate', name: 'Migrate data and hand over', type: 'task', group: 'End-User Computing', dependsOn: ['procure'] },
    ],
  },
  {
    id: 'cat-software', name: 'Software License Request', department: 'IT', category: 'Software', icon: '📦',
    description: 'Request licensed software such as Adobe Acrobat Pro, Visio or Project.',
    fields: [
      { key: 'product', label: 'Product', type: 'select', options: ['Adobe Acrobat Pro', 'Microsoft Visio', 'Microsoft Project', 'Other'], required: true },
      { key: 'justification', label: 'Business justification', type: 'textarea', required: true },
    ],
    workflow: [
      { id: 'mgr', name: 'Manager approval', type: 'approval', group: 'Requester manager' },
      { id: 'install', name: 'Assign license and deploy', type: 'task', group: 'Service Desk', dependsOn: ['mgr'] },
    ],
  },
  {
    id: 'cat-access', name: 'Shared Drive / Application Access', department: 'IT', category: 'Access & Identity', icon: '🔑',
    description: 'Request access to a shared folder, mailbox or business application.',
    fields: [
      { key: 'resource', label: 'Resource', type: 'text', required: true },
      { key: 'level', label: 'Access level', type: 'select', options: ['Read', 'Read / Write', 'Owner'], required: true },
    ],
    workflow: [
      { id: 'owner', name: 'Resource owner approval', type: 'approval', group: 'Resource owner' },
      { id: 'grant', name: 'Grant access', type: 'task', group: 'Identity & Access', dependsOn: ['owner'] },
    ],
  },
  {
    id: 'cat-move', name: 'Office Move / Desk Setup', department: 'Facilities', category: 'Facilities', icon: '🏢',
    description: 'Move a person or team: desks, phones, network ports and keys.',
    fields: [
      { key: 'from', label: 'From location', type: 'text', required: true },
      { key: 'to', label: 'To location', type: 'text', required: true },
      { key: 'moveDate', label: 'Move date', type: 'date', required: true },
    ],
    workflow: [
      { id: 'fac', name: 'Facilities planning', type: 'task', group: 'Facilities Services' },
      { id: 'net', name: 'Patch network ports', type: 'task', group: 'Network Operations', dependsOn: ['fac'] },
      { id: 'phone', name: 'Move desk phones', type: 'task', group: 'End-User Computing', dependsOn: ['fac'] },
    ],
  },
  {
    id: 'cat-purchase', name: 'Purchase Request', department: 'Finance', category: 'Finance', icon: '🧾',
    description: 'Buy goods or services. Multi-level approval by value.',
    fields: [
      { key: 'item', label: 'Item / service', type: 'text', required: true },
      { key: 'amount', label: 'Amount (USD)', type: 'number', required: true },
      { key: 'costCenter', label: 'Cost center', type: 'text', required: true },
    ],
    workflow: [
      { id: 'mgr', name: 'Manager approval', type: 'approval', group: 'Requester manager' },
      { id: 'dir', name: 'Director approval (> $10,000)', type: 'approval', group: 'Department director', dependsOn: ['mgr'], condition: { field: 'amount', op: 'gt', value: 10000 } },
      { id: 'po', name: 'Raise purchase order', type: 'task', group: 'Finance Operations', dependsOn: ['dir'] },
    ],
  },
];

export const ASSETS = [
  { id: 'svc-vpn', name: 'Remote Access VPN', type: 'Business service', owner: 'Network Operations', dependsOn: ['ci-vpn-gw-01', 'ci-fw-core-01', 'ci-entra'] },
  { id: 'svc-email', name: 'Email & Calendar', type: 'Business service', owner: 'Messaging & Collaboration', dependsOn: ['ci-exo', 'ci-entra'] },
  { id: 'svc-erp', name: 'ERP Finance', type: 'Business service', owner: 'Finance Operations', dependsOn: ['ci-erp-app', 'ci-erp-db', 'ci-fw-core-01'] },
  { id: 'svc-cms', name: 'Court Case Management', type: 'Business service', owner: 'Service Desk', dependsOn: ['ci-cms-app', 'ci-sw-court-02'] },
  { id: 'ci-vpn-gw-01', name: 'vpn-gw-01', type: 'Network appliance', owner: 'Network Operations', location: 'Data Center A' },
  { id: 'ci-fw-core-01', name: 'fw-core-01', type: 'Firewall', owner: 'Network Operations', location: 'Data Center A' },
  { id: 'ci-sw-court-02', name: 'sw-court-02', type: 'Network switch', owner: 'Network Operations', location: 'Courthouse, floor 2' },
  { id: 'ci-entra', name: 'Microsoft Entra ID tenant', type: 'Cloud service', owner: 'Identity & Access' },
  { id: 'ci-exo', name: 'Exchange Online', type: 'Cloud service', owner: 'Messaging & Collaboration' },
  { id: 'ci-erp-app', name: 'erp-app-01', type: 'Application server', owner: 'Finance Operations', location: 'Azure East US' },
  { id: 'ci-erp-db', name: 'erp-db-01', type: 'Database', owner: 'Finance Operations', location: 'Azure East US' },
  { id: 'ci-cms-app', name: 'cms-app-01', type: 'Application server', owner: 'Service Desk', location: 'Data Center A' },
  { id: 'hw-LT-20431', name: 'LT-20431 (Dell Latitude 7450)', type: 'Laptop', owner: 'Dana Whitfield', warrantyEnd: '2027-03-31', tag: 'QR' },
  { id: 'hw-LT-19877', name: 'LT-19877 (HP EliteBook 840)', type: 'Laptop', owner: 'Robert Chen', warrantyEnd: '2026-12-15', tag: 'QR' },
  { id: 'lic-m365-e3', name: 'Microsoft 365 E3', type: 'License', owner: 'Messaging & Collaboration', seatsTotal: 1200, seatsUsed: 1163, renewal: '2027-01-31' },
  { id: 'lic-acrobat', name: 'Adobe Acrobat Pro', type: 'License', owner: 'Service Desk', seatsTotal: 150, seatsUsed: 149, renewal: '2026-12-01' },
];

export const DEFAULT_GOVERNANCE = {
  category: 'auto',
  priority: 'approve',
  assignment: 'suggest',
  merge: 'approve',
  kbDraft: 'approve',
};

const CHANNELS = ['email', 'teams', 'portal', 'portal', 'mobile', 'sms', 'chat', 'virtual-agent'];

/** Build the full demo database relative to `now`. */
export function buildSeed(now = Date.now()) {
  const r = rng(20261106);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const prio = (i, u) => ['P1', 'P2', 'P3', 'P3', 'P4'][i + u - 2];
  const tickets = [];
  let n = 1000;

  for (let k = 0; k < 64; k++) {
    const ex = EXAMPLES[k % EXAMPLES.length];
    const [category, title, description, impact, urgency] = ex;
    const meta = CATEGORIES[category];
    const ageMs = r() * 14 * DAY + 20 * MIN;
    const createdAt = now - ageMs;
    const priority = prio(impact, urgency);
    const techs = TECHNICIANS.filter((t) => t.group === meta.group);
    const tech = pick(techs);
    const requester = pick(REQUESTERS);
    const type = ['HR', 'Facilities', 'Finance'].includes(category) || /request|install|access|onboarding|move/i.test(title) ? 'request' : 'incident';
    const t = {
      id: `${type === 'incident' ? 'INC' : 'REQ'}-${++n}`,
      type, title, description,
      channel: pick(CHANNELS),
      requester,
      department: meta.department,
      category, impact, urgency, priority,
      status: 'open',
      assignmentGroup: meta.group,
      assignee: tech.id,
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt),
      firstResponseAt: null,
      resolvedAt: null,
      pauses: [],
      comments: [],
      links: [],
      parentId: null,
      reassignments: r() < 0.2 ? 1 : 0,
      csat: null,
      ai: {},
      ciIds: category === 'Network' ? ['ci-vpn-gw-01'] : [],
      tags: [],
    };
    const policy = SLA_POLICIES.find((p) => p.id === priority);
    const cal = CALENDARS.find((c) => c.id === policy.calendarId);
    const respAt = addBusinessMinutes(createdAt, policy.responseMinutes * (0.2 + r() * 0.75), cal);
    if (respAt < now) t.firstResponseAt = iso(respAt);
    // ~1 in 8 resolutions run past the SLA so the demo shows realistic breaches.
    const stretch = r() < 0.12 ? 1.1 + r() * 0.8 : 0.15 + r() * 0.8;
    const resolveAt = addBusinessMinutes(createdAt, policy.resolutionMinutes * stretch, cal);
    if (resolveAt < now && t.firstResponseAt && (['P1', 'P2'].includes(priority) || r() < 0.9)) {
      t.resolvedAt = iso(resolveAt);
      t.status = now - resolveAt > 2 * DAY ? 'closed' : 'resolved';
      t.csat = r() < 0.7 ? (r() < 0.8 ? 5 : r() < 0.6 ? 4 : 3) : null;
      t.comments.push({ id: `c-${n}-1`, author: tech.name, role: 'agent', public: true, body: 'Resolved — please reopen if the issue returns.', at: t.resolvedAt });
    } else if (t.firstResponseAt) {
      t.status = r() < 0.2 ? 'pending' : 'in_progress';
      if (t.status === 'pending') t.pauses.push({ start: iso(now - r() * 4 * HOUR), end: null, reason: 'Awaiting requester' });
    } else {
      t.status = 'new';
      t.assignee = null;
    }
    if (t.firstResponseAt) t.comments.unshift({ id: `c-${n}-0`, author: tech.name, role: 'agent', public: true, body: 'Thanks — we are looking into this.', at: t.firstResponseAt });
    t.updatedAt = t.resolvedAt || t.firstResponseAt || t.createdAt;
    tickets.push(t);
  }

  // A live major-incident scenario: VPN outage during month-end close.
  const mi = {
    ...tickets[0],
    id: `INC-${++n}`,
    title: 'VPN outage — Finance cannot connect during month-end close',
    description: 'Multiple reports: VPN gateway rejecting connections since 08:40. Finance month-end close is blocked.',
    channel: 'teams', priority: 'P1', impact: 1, urgency: 1, status: 'in_progress',
    createdAt: iso(now - 50 * MIN), updatedAt: iso(now - 10 * MIN), firstResponseAt: iso(now - 44 * MIN), resolvedAt: null,
    assignee: 'tech-01', majorIncident: true, ciIds: ['ci-vpn-gw-01'], pauses: [], csat: null, links: [], ai: {}, tags: ['major-incident'],
    comments: [{ id: 'c-mi-1', author: 'Priya Raman', role: 'agent', public: true, body: 'Major incident declared. Bridge open; vendor engaged on vpn-gw-01 certificate issue.', at: iso(now - 40 * MIN) }],
  };
  const children = [];
  for (const who of REQUESTERS.slice(0, 3)) {
    children.push({
      ...mi, id: `INC-${++n}`, majorIncident: false, parentId: mi.id, requester: who,
      title: 'Cannot connect to VPN', description: 'VPN client says the gateway is unreachable.', channel: pick(CHANNELS),
      createdAt: iso(now - 35 * MIN + children.length * 5 * MIN), firstResponseAt: iso(now - 30 * MIN + children.length * 5 * MIN),
      comments: [], links: [], ai: {}, tags: [], pauses: [], ciIds: ['ci-vpn-gw-01'],
    });
  }
  mi.links = children.map((c) => c.id);
  tickets.push(mi, ...children);

  const banners = [{ id: 'ban-1', ticketId: mi.id, severity: 'critical', text: 'VPN outage in progress — engineers are working on it. No need to open a new ticket; updates every 30 minutes.', createdAt: iso(now - 40 * MIN), active: true }];

  return {
    meta: { seededAt: iso(now), nextId: n + 1 },
    tickets,
    banners,
    kb: KB_ARTICLES.map(([title, category, audience, body], i) => ({
      id: `KB-${100 + i}`, title, category, audience, body, status: 'published', version: 1 + (i % 3),
      reviewDate: iso(now + (30 + i * 11) * DAY), views: Math.floor(r() * 900) + 40, helpful: Math.floor(r() * 90) + 5,
    })),
    catalog: CATALOG,
    assets: ASSETS,
    technicians: TECHNICIANS,
    settings: { aiGovernance: { ...DEFAULT_GOVERNANCE }, slaPolicies: SLA_POLICIES, calendars: CALENDARS },
    audit: [{ id: 'aud-1', at: iso(now), actor: 'system', action: 'seed', target: 'database', detail: { tickets: tickets.length } }],
  };
}
