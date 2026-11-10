export type LocalProjectType =
  | 'NEW_HOME'
  | 'RENOVATION'
  | 'REPAIR'
  | 'INSPECTION'
  | 'EXTENSION'
  | 'UNSURE';

export type LocalPlan = {
  id: string;
  title: string;
  summary: string;
  stages: {title: string; detail: string}[];
  recommendations: {
    label: string;
    action: 'ENGINEERS' | 'SERVICES' | 'REQUESTS';
    query?: string;
  }[];
  checklist: string[];
  missingInformation: string[];
  safetyNote: string;
  version: number;
};

type PlanInput = {
  projectType: LocalProjectType;
  city?: string;
  propertyType?: string;
  budgetRange?: string;
  timeline?: string;
  details?: string;
  documentCount: number;
};

const projectNames: Record<LocalProjectType, string> = {
  NEW_HOME: 'New home',
  RENOVATION: 'Renovation',
  REPAIR: 'Home repair',
  INSPECTION: 'Property inspection',
  EXTENSION: 'Home extension',
  UNSURE: 'Home project',
};

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function createLocalConversation() {
  return id('local-plan');
}

const LOCAL_IN_DOMAIN_HINTS = /build|construct|renovat|repair|fix|leak|paint|crack|plumb|electric|wire|mason|carpent|tile|roof|wall|floor|kitchen|bathroom|bedroom|house|home|villa|apartment|flat|plot|site|engineer|contractor|cement|concrete|brick|steel|wood|door|window|pipe|tap|drain|tank|borewell|interior|pillar|beam|slab|foundation|estimate|cost|budget|quote|rate|bhk|room|terrace|nahtreek|subscri|vastu/i;
const LOCAL_OFF_TOPIC = /movie|film|actor|netflix|cricket|football|ipl|politic|election|homework|exam|python|javascript| coding|software|recipe|song|lyrics|astrolog|horoscope|crypto|bitcoin|stock market|joke|poem|riddle|credit card|doctor|visa|passport|flight/i;

export function isLocalCompanyQuestion(message: string) {
  return /nahtreek|your (company|app)|who (are|made|built|created) you|about (the|this|your) (app|company)/i.test(message);
}

export function isLocalOffTopic(message: string) {
  if (!message.trim() || LOCAL_IN_DOMAIN_HINTS.test(message)) return false;
  return LOCAL_OFF_TOPIC.test(message);
}

const LOCAL_SERVICE_INTENTS: {serviceId: string; label: string; pro: string; pattern: RegExp}[] = [
  {serviceId: 'plumbing', label: 'Plumbing', pro: 'a verified plumber', pattern: /plumb|tap\b|faucet|leak|pipe\b|pipes|drain|clog|flush tank|cistern|borewell|motor pump|sump/i},
  {serviceId: 'electrical', label: 'Electrical', pro: 'a verified electrician', pattern: /electric|switch|socket|wiring|wire\b|fan\b|light\b|power\b|fuse|mcb|inverter/i},
  {serviceId: 'ac', label: 'AC Service', pro: 'a verified AC technician', pattern: /\bac\b|air[ -]?condition|cooling|gas refill|compressor/i},
  {serviceId: 'cleaning', label: 'Home Cleaning', pro: 'a verified cleaning team', pattern: /clean|maid|mop|dust|sweep|sofa|carpet/i},
  {serviceId: 'painting', label: 'Painting', pro: 'a verified painter', pattern: /paint|repaint|whitewash|distemper|putty|wallpaper/i},
  {serviceId: 'carpentry', label: 'Carpentry', pro: 'a verified carpenter', pattern: /carpent|furniture|wardrobe|door\b|window\b|wood|plywood|hinge|lock\b|modular kitchen/i},
  {serviceId: 'masonry', label: 'Masonry', pro: 'a verified mason', pattern: /mason|brick|plaster|cement|concrete|tile\b|tiling|flooring|wall crack/i},
  {serviceId: 'waterproofing', label: 'Waterproofing', pro: 'a verified waterproofing specialist', pattern: /waterproof|damp|seepage|terrace leak|roof leak/i},
  {serviceId: 'pest-control', label: 'Pest Control', pro: 'a verified pest-control professional', pattern: /pest|termite|cockroach|rodent|mosquito control|bed ?bug/i},
  {serviceId: 'appliance', label: 'Appliance Repair', pro: 'a verified appliance technician', pattern: /appliance|refrigerator|fridge|washing machine|microwave|chimney|geyser|water purifier|tv repair/i},
];

export function detectLocalServiceIntent(text: string) {
  const found = LOCAL_SERVICE_INTENTS.find(intent => intent.pattern.test(text));
  return found ? {serviceId: found.serviceId, label: found.label, pro: found.pro} : null;
}

export type LocalPlanFigures = {freeMessages: number; feePaisa: number} | null;

// Plan figures ride in from the cached /ai-billing/plan view when the screen
// has one; with no figures the copy stays generic instead of hardcoding them.
export function localPlannerReply(projectType: LocalProjectType, message: string, plan?: LocalPlanFigures) {
  const project = projectNames[projectType].toLowerCase();
  const detail = message.trim();
  if (isLocalCompanyQuestion(detail)) {
    const plus = plan
      ? `NAHTREEK AI (${plan.freeMessages} free chats, then ₹${(plan.feePaisa / 100).toLocaleString('en-IN')}/month)`
      : 'NAHTREEK AI (free to start — a Plus plan unlocks more)';
    return `NAHTREEK connects homeowners with verified civil engineers and home-service providers. In this Home app you can find pros, raise requests, chat in-app, and track jobs — and ${plus} helps you plan the work. What are you building or fixing?`;
  }
  if (isLocalOffTopic(detail))
    return 'I can only help with home construction, repairs, services, and questions about the NAHTREEK app. What are you planning to build or fix?';
  const service = detectLocalServiceIntent(detail);
  if (service) {
    const serviceQuestion = /today|tomorrow|urgent|asap|morning|evening/i.test(detail)
      ? 'Which city and area should the visit cover?'
      : 'Do you need a visit today or can it be scheduled?';
    return `Understood: “${detail}” — a ${service.label.toLowerCase()} job.\nDo this first: note exactly where it happens, how often, and anything unsafe to touch — that description goes straight into your booking.\nWatch out: never lock a price until ${service.pro} has inspected the site.\nOne question: ${serviceQuestion} Once you add that, tap Generate my plan and I will line up ${service.pro} near you.`;
  }
  const question = /budget|lakh|₹|rs\.?/i.test(detail)
    ? 'What is your preferred start date or deadline?'
    : /month|week|today|urgent|timeline|start/i.test(detail)
      ? 'What budget range are you comfortable with?'
      : 'What is the property type and city for this work?';
  return detail
    ? `Understood: “${detail}” — for your ${project}.\nDo this first: confirm the exact scope (rooms or area, what must change, what must stay) before agreeing any work or price.\nWatch out: never lock a price until a verified pro has inspected the site.\nOne question: ${question} Then tap Generate my plan for prioritised next steps.`
    : `Tell us what you need for your ${project}, and we will organise the next steps.`;
}

export function createLocalPlan(input: PlanInput): LocalPlan {
  const project = projectNames[input.projectType];
  const repair = input.projectType === 'REPAIR';
  const scope = input.details?.trim() || 'the work you described';
  const service = detectLocalServiceIntent(input.details ?? '');
  if (service && (repair || input.projectType === 'UNSURE' || input.projectType === 'INSPECTION')) {
    return {
      id: id('plan'),
      version: 1,
      title: `${service.label} plan`,
      summary: `${service.label} for ${input.city || 'your area'}, based on ${scope}. Describe the symptom precisely, pick ${service.pro} nearby, and confirm the visit price before work starts.`,
      stages: [
        {title: 'Do this first: describe the symptom', detail: `Write where it happens, since when, and how often — for example "${scope}". This description is carried into your booking request.`},
        {title: `Compare ${service.label.toLowerCase()} professionals`, detail: `Open the ${service.label} list and compare verified local pros on rating, experience, and visit price — not price alone.`},
        {title: 'Confirm the visit', detail: 'Agree the scope, visit timing, estimate, and any diagnostic charge before the professional starts work.'},
      ],
      recommendations: [
        {label: `Find ${service.label.toLowerCase()} near me`, action: 'SERVICES', query: service.serviceId},
        {label: 'Book this service', action: 'REQUESTS', query: service.serviceId},
      ],
      checklist: [
        input.documentCount ? `Prepare ${input.documentCount} attached photo${input.documentCount === 1 ? '' : 's'} showing the issue` : 'Add a photo of the issue if it helps explain the work',
        input.budgetRange ? `Use ${input.budgetRange} as a planning range and confirm exclusions` : 'Choose an approximate budget range',
        input.timeline ? `Work backwards from ${input.timeline}` : 'Choose whether you need a visit today or can schedule it',
        'Keep the work area clear and reachable before the visit',
      ],
      missingInformation: [
        ...(input.details?.trim() ? [] : ['a short description of the symptom']),
        ...(input.city ? [] : ['visit city and area']),
        ...(input.budgetRange ? [] : ['budget range']),
        ...(input.timeline ? [] : ['visit timing: today or scheduled']),
      ],
      safetyNote: 'This is planning guidance. Do not touch exposed wiring, gas fittings, or unsafe structures — wait for the professional.',
    };
  }
  return {
    id: id('plan'),
    version: 1,
    title: `${project} plan`,
    summary: `${project} for ${input.city || 'your area'}, based on ${scope}. First confirm the scope${input.budgetRange ? ` within ${input.budgetRange}` : ''}${input.timeline ? ` for ${input.timeline}` : ''}, then choose the right verified professional before work begins.`,
    stages: repair
      ? [
          {title: 'Do this first: make the issue safe', detail: 'Note the affected area, urgency, and when it started. Stop and seek urgent help if there is a leak near electricity, a gas smell, or another safety concern.'},
          {title: 'Choose the right service', detail: 'Compare verified local providers and clearly describe the symptoms before booking.'},
          {title: 'Confirm the visit', detail: 'Agree the scope, timing, estimate, and any diagnostic charge before work starts.'},
        ]
      : [
          {title: 'Do this first: clarify the outcome', detail: 'List the rooms, goals, and practical limits. Write what must change and what must stay the same.'},
          {title: 'Reduce the biggest risk', detail: 'Choose an engineer or specialist before structural or major work starts.'},
          {title: 'Plan the work', detail: `Confirm a budget range${input.budgetRange ? ` around ${input.budgetRange}` : ''}, sequence, and start date${input.timeline ? ` for ${input.timeline}` : ''} with the selected professional.`},
        ],
    recommendations: repair
      ? [
          {label: 'Find home services', action: 'SERVICES'},
          {label: 'Create a service request', action: 'REQUESTS'},
        ]
      : [
          {label: 'Find verified engineers', action: 'ENGINEERS', query: 'Structural Design'},
          {label: 'Find home services', action: 'SERVICES'},
          {label: 'Start a request', action: 'REQUESTS'},
        ],
    checklist: [
      input.documentCount ? `Prepare ${input.documentCount} attached photo${input.documentCount === 1 ? '' : 's'} for a professional discussion` : 'Add a site photo or short brief if it helps explain the work',
      input.propertyType ? `Confirm property type: ${input.propertyType}` : 'Choose the property type',
      input.budgetRange ? `Use ${input.budgetRange} as a planning range and confirm exclusions` : 'Choose an approximate budget range',
      input.timeline ? `Work backwards from ${input.timeline}` : 'Choose a preferred start period',
      'Write three questions to ask before confirming work',
    ],
    missingInformation: [
      ...(input.propertyType ? [] : ['property type']),
      ...(input.budgetRange ? [] : ['budget range']),
      ...(input.timeline ? [] : ['preferred start period']),
    ],
    safetyNote: 'This is planning guidance. A qualified professional must review structural, electrical, legal, and approval decisions before work starts.',
  };
}
