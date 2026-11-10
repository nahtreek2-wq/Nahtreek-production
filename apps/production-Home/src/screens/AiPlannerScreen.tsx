import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import Animated, {FadeInDown, ReduceMotion} from 'react-native-reanimated';
import {useQueryClient} from '@tanstack/react-query';
import {launchImageLibrary} from 'react-native-image-picker';
import Voice from '@react-native-voice/voice';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {AppHeader, Button, Icon, ICONS} from '../components/ui';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {ClientColors} from '../design-system/tokens';
import {useFormKeyboardScroll} from '../hooks/useFormKeyboardScroll';
import {api} from '../services/apiClient';
import {
  activateDemoAi,
  cancelAiSubscription,
  confirmAiSubscription,
  fetchAiPlan,
  fetchAiSubscription,
  isConfirmingError,
  isPaywallError,
  quotaLabel,
  subscribeAi,
  type AiPlanView,
  type AiSubscriptionView,
} from '../services/aiBilling';
import {inr, inrMonth} from '../utils/format';
import {setAiBookingPrefill} from '../services/aiBookingPrefill';
import {isApiConfigured} from '../services/config';
import {runtimeConfig} from '../config/runtime';
import {createAndShareProjectBrief} from '../services/projectBrief';
import {
  createLocalConversation,
  createLocalPlan,
  localPlannerReply,
} from '../services/localAiPlanner';
import {useSessionStore} from '../stores/session';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProjectType =
  | 'NEW_HOME'
  | 'RENOVATION'
  | 'REPAIR'
  | 'INSPECTION'
  | 'EXTENSION'
  | 'UNSURE';
type Plan = {
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
type Message = {id: string; type: string; content: string; metadata?: {kind?: string; urgency?: string; engine?: string}};
type AiDocument = {id: string; fileName: string; status: string; extractedSummary?: string};
type RateCard = {serviceKey: string; label: string; rangeLabel: string; note?: string | null};
type Conversation = {
  id: string;
  messages?: Message[];
  documents?: AiDocument[];
  plans?: Plan[];
};
const AI_ICON_COLOR = Colors.navyDeep;
const AI_BRAND_COLOR = Colors.navyDeep;

const RICH_LABEL_RE = /^(Understood|Do this first|Watch out|One question|புரிந்தது|முதலில் செய்ய வேண்டியது|கவனம்|ஒரு கேள்வி):\s*/;
const RICH_BULLET_RE = /^(•|[-*]|\d+[.)])\s+/;

// Minimal structured-text renderer for AI replies: bold labels, bullets and
// **bold** spans without pulling in a markdown dependency.
function InlineRich({text}: {text: string}) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={styles.richBold}>{part}</Text>
        ) : (
          <Text key={index}>{part}</Text>
        ),
      )}
    </>
  );
}

function RichLine({line, user, first}: {line: string; user: boolean; first: boolean}) {
  const bullet = line.match(RICH_BULLET_RE);
  const body = bullet ? line.slice(bullet[0].length) : line;
  const label = body.match(RICH_LABEL_RE);
  const rest = label ? body.slice(label[0].length) : body;
  return (
    <Text style={[styles.messageText, user && styles.userMessageText, bullet && styles.richBullet, !first && styles.richLineGap]}>
      {bullet ? '• ' : ''}
      {label ? <Text style={styles.richBold}>{label[0]}</Text> : null}
      <InlineRich text={rest} />
    </Text>
  );
}

function RichMessageText({content, user}: {content: string; user: boolean}) {
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  return (
    <>
      {lines.map((line, index) => (
        <RichLine key={index} line={line} user={user} first={index === 0} />
      ))}
    </>
  );
}

const STARTER_CHIPS = ['Estimate my budget', 'What should I ask a pro?', 'How urgent is this?'];

function TypingDots() {
  return (
    <View style={styles.typingDots} accessibilityLabel="NAHTREEK AI is typing">
      {[0, 1, 2].map(index => (
        <View key={index} style={styles.typingDot} />
      ))}
    </View>
  );
}

const PROJECTS: {
  type: ProjectType;
  title: string;
  subtitle: string;
  icon: keyof typeof ICONS;
}[] = [
  {
    type: 'NEW_HOME',
    title: 'Build a home',
    subtitle: 'Plan a new house from the start',
    icon: 'building',
  },
  {
    type: 'RENOVATION',
    title: 'Renovate a property',
    subtitle: 'Improve or change your home',
    icon: 'serviceHero',
  },
  {
    type: 'REPAIR',
    title: 'Repair something',
    subtitle: 'Fix a problem quickly',
    icon: 'plumbing',
  },
  {
    type: 'INSPECTION',
    title: 'Inspect a property',
    subtitle: 'Understand condition and risks',
    icon: 'verified',
  },
  {
    type: 'EXTENSION',
    title: 'Plan an extension',
    subtitle: 'Add rooms or expand space',
    icon: 'plot',
  },
  {
    type: 'UNSURE',
    title: 'I am not sure yet',
    subtitle: 'Get help choosing the next step',
    icon: 'ai',
  },
];

function ProjectChoice({project, index, busy, selected, onPress}: {
  project: (typeof PROJECTS)[number];
  index: number;
  busy: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(280).delay(Math.min(index * 45, 225)).reduceMotion(ReduceMotion.System)} style={styles.choiceOuter}>
        <Pressable
          style={({pressed}) => [styles.choice, pressed && styles.choicePressed]}
          accessibilityRole="button"
          accessibilityLabel={`${project.title}. ${project.subtitle}`}
          accessibilityState={{disabled: busy, busy: selected}}
          onPress={onPress}
          disabled={busy}>
          <View style={styles.choiceIcon}>
            <Icon name={ICONS[project.icon]} size={22} color={AI_ICON_COLOR} />
          </View>
          <View style={styles.choiceCopy}>
            <Text style={styles.choiceTitle}>{project.title}</Text>
            <Text style={styles.choiceText}>{project.subtitle}</Text>
          </View>
          {selected ? <ActivityIndicator color={Colors.slate500} /> : <Icon name={ICONS.chevronRight} color={Colors.navyMid} />}
        </Pressable>
    </Animated.View>
  );
}

export function AiPlannerScreen() {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const route = useRoute<any>();
  const user = useSessionStore(state => state.user);
  const [conversationId, setConversationId] = useState<string | undefined>(
    route.params?.conversationId,
  );
  const [projectType, setProjectType] = useState<ProjectType | undefined>();
  const [details, setDetails] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [budgetRange, setBudgetRange] = useState('');
  const [timeline, setTimeline] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [documents, setDocuments] = useState<AiDocument[]>([]);
  const [language, setLanguage] = useState<'en' | 'ta'>('en');
  const [listening, setListening] = useState(false);
  const heardSpeech = useRef(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [plan, setPlan] = useState<Plan | undefined>();
  const [busy, setBusy] = useState(false);
  const [startingType, setStartingType] = useState<ProjectType | undefined>();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [billing, setBilling] = useState<AiSubscriptionView | null>(null);
  const [plusPlan, setPlusPlan] = useState<AiPlanView | null>(null);
  const plusPrice = plusPlan ? inrMonth(plusPlan.feePaisa) : billing ? inrMonth(billing.feePaisa) : 'NAHTREEK Plus';
  const consultPerk = plusPlan
    ? `${plusPlan.consultDiscountBps / 100}% off engineer consultations (up to ${inr(plusPlan.consultDiscountCapPaisa)})`
    : 'Consultation discounts on engineer bookings';
  const [paywalled, setPaywalled] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const keyboardScroll = useFormKeyboardScroll(28);
  const scroll = keyboardScroll.scrollRef;
  const visibleMessages = messages.filter(item => item.type !== 'SYSTEM');

  const refreshBilling = async () => {
    if (!isApiConfigured || !user) return;
    try {
      setBilling(await fetchAiSubscription());
    } catch {
      // Quota display is best-effort; the server still gates every AI action.
    }
    try {
      setPlusPlan(await fetchAiPlan());
    } catch {
      // Plan copy falls back to the subscription fee already loaded.
    }
  };

  useEffect(() => {
    void refreshBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    Voice.onSpeechPartialResults = (event: {value?: string[]}) => {
      const text = event.value?.[0];
      if (text) {
        heardSpeech.current = true;
        setMessage(text);
      }
    };
    Voice.onSpeechResults = (event: {value?: string[]}) => {
      const text = event.value?.[0];
      if (text) {
        heardSpeech.current = true;
        setMessage(text);
      }
    };
    Voice.onSpeechEnd = () => setListening(false);
    Voice.onSpeechError = () => {
      setListening(false);
      // End-of-speech errors are routine after real dictation; only complain
      // when nothing was heard at all (missing service, blocked mic).
      if (!heardSpeech.current) setError('Voice input is not available on this device right now.');
    };
    return () => {
      Voice.destroy().catch(() => undefined);
      Voice.removeAllListeners();
    };
  }, []);

  const toggleVoice = async () => {
    try {
      if (listening) {
        await Voice.stop();
        setListening(false);
        return;
      }
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setError('Microphone permission is needed for voice input.');
          return;
        }
      }
      setError('');
      heardSpeech.current = false;
      await Voice.start(language === 'ta' ? 'ta-IN' : 'en-IN');
      setListening(true);
    } catch {
      setListening(false);
      setError('Voice input is not available on this device right now.');
    }
  };

  const loadRates = async (city?: string | null) => {
    if (!isApiConfigured) return;
    try {
      const cards = await api.get<RateCard[]>(
        `/ai/rate-cards${city ? `?city=${encodeURIComponent(city)}` : ''}`,
      );
      setRateCards(cards);
    } catch {
      // The cost guide is optional; chat and plans work without it.
    }
  };

  const failOrPaywall = (cause: unknown, fallback: string) => {
    if (isPaywallError(cause)) {
      setPaywalled(true);
      void refreshBilling();
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
  };

  // Billing views merge over the previous one so a view without quota fields
  // can never blank the free-chat pill.
  const applyBilling = (view: AiSubscriptionView) => {
    setBilling(previous => (previous ? {...previous, ...view} : view));
    // Detail screens read billing through react-query: keep their Plus
    // badge and discount in sync with subscribe/confirm/cancel here.
    void queryClient.invalidateQueries({queryKey: ['ai-billing']});
  };

  // After a successful GPay payment the first charge still needs seconds to
  // land at Razorpay. Poll confirm (then the plain status as a webhook may
  // have flipped it) instead of stranding the user on an error.
  const pollActivation = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      try {
        const view = await confirmAiSubscription();
        applyBilling(view);
        setActivating(false);
        setPaywalled(false);
        return;
      } catch (cause) {
        if (!isConfirmingError(cause)) {
          setActivating(false);
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not confirm the payment.',
          );
          return;
        }
      }
    }
    try {
      const view = await fetchAiSubscription();
      applyBilling(view);
      if (view.effective) {
        setActivating(false);
        setPaywalled(false);
        return;
      }
    } catch {
      // Fall through to the wait-and-reopen message below.
    }
    setActivating(false);
    setError(
      'Payment is still confirming at Razorpay. Wait a minute, then reopen this screen — do not pay again.',
    );
  };

  const subscribe = async () => {
    setSubscribing(true);
    setError('');
    try {
      const view = await subscribeAi();
      applyBilling(view);
      setPaywalled(false);
    } catch (cause) {
      if (isConfirmingError(cause)) {
        setActivating(true);
        void pollActivation();
        return;
      }
      setError(
        cause instanceof Error ? cause.message : 'Could not start the subscription.',
      );
    } finally {
      setSubscribing(false);
    }
  };

  const demoActivate = async () => {
    setSubscribing(true);
    setError('');
    try {
      const view = await activateDemoAi();
      applyBilling(view);
      setPaywalled(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not activate free access.',
      );
    } finally {
      setSubscribing(false);
    }
  };

  const cancel = () => {
    Alert.alert('Cancel AI subscription?', 'You keep unlimited AI until the paid period ends.', [
      {text: 'Keep it', style: 'cancel'},
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: () =>
          cancelAiSubscription()
            .then(view => applyBilling(view))
            .catch(cause =>
              setError(cause instanceof Error ? cause.message : 'Could not cancel the subscription.'),
            ),
      },
    ]);
  };

  const start = async (type: ProjectType) => {
    setBusy(true);
    setStartingType(type);
    setError('');
    try {
      const conversation = isApiConfigured
        ? await api.post<Conversation>('/ai/conversations', {projectType: type})
        : {id: createLocalConversation(), messages: []};
      setProjectType(type);
      setConversationId(conversation.id);
      setMessages(conversation.messages ?? []);
      void loadRates(user?.homeCity);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not start the planner.',
      );
    } finally {
      setBusy(false);
      setStartingType(undefined);
    }
  };

  const send = async (preset?: string) => {
    const content = (preset ?? message).trim();
    if (!conversationId || !content || busy) return;
    if (listening) {
      Voice.stop().catch(() => undefined);
      setListening(false);
    }
    setMessage('');
    setBusy(true);
    setError('');
    setMessages(current => [
      ...current,
      {id: `local-${Date.now()}`, type: 'USER_TEXT', content},
    ]);
    try {
      const reply = isApiConfigured
        ? await api.post<Message>(
            `/ai/conversations/${conversationId}/messages`,
            {content, language},
          )
        : {
            id: `local-reply-${Date.now()}`,
            type: 'ASSISTANT_TEXT',
            content: localPlannerReply(projectType ?? 'UNSURE', content,
              plusPlan ? {freeMessages: plusPlan.freeMessages, feePaisa: plusPlan.feePaisa}
                : billing ? {freeMessages: billing.freeQuota, feePaisa: billing.feePaisa} : null),
          };
      setMessages(current => [...current, reply]);
      void refreshBilling();
    } catch (cause) {
      failOrPaywall(cause, 'Could not send your message.');
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async () => {
    if (!conversationId) return;
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      includeBase64: true,
      quality: 0.7,
      maxWidth: 1600,
      maxHeight: 1600,
    });
    const asset = result.assets?.[0];
    if (!asset?.base64 || !asset.type) return;
    setBusy(true);
    setError('');
    try {
      const uploaded = isApiConfigured
        ? await api.post<{id: string; fileName: string; status: string}>(
            '/ai/documents',
            {
              conversationId,
              fileName: asset.fileName || 'project-photo.jpg',
              mimeType: asset.type,
              contentBase64: asset.base64,
            },
          )
        : {
            id: `local-photo-${Date.now()}`,
            fileName: asset.fileName || 'project-photo.jpg',
            status: 'attached',
          };
      setDocuments(current => [uploaded, ...current]);
      void refreshBilling();
    } catch (cause) {
      failOrPaywall(cause, 'Could not add this photo.');
    } finally {
      setBusy(false);
    }
  };

  const createPlan = async () => {
    if (!conversationId || !projectType) return;
    setBusy(true);
    setError('');
    try {
      const created = isApiConfigured
        ? await api.post<Plan>(`/ai/conversations/${conversationId}/plans`, {
            projectType,
            propertyType,
            budgetRange,
            timeline,
            details,
            language,
          })
        : createLocalPlan({
            projectType,
            propertyType,
            budgetRange,
            timeline,
            details,
            documentCount: documents.length,
            city: user?.homeCity,
          });
      setPlan(created);
      setDetailsExpanded(false);
      void refreshBilling();
    } catch (cause) {
      failOrPaywall(cause, 'Could not create your plan.');
    } finally {
      setBusy(false);
    }
  };

  const analyzePhoto = async (documentId: string) => {
    if (!isApiConfigured || analyzing) return;
    setAnalyzing(documentId);
    setError('');
    try {
      const result = await api.post<{document: AiDocument; message: Message}>(
        `/ai/documents/${documentId}/analyze`,
        {language},
      );
      setDocuments(current =>
        current.map(item =>
          item.id === documentId
            ? {...item, extractedSummary: result.document.extractedSummary}
            : item,
        ),
      );
      setMessages(current => [...current, result.message]);
      void refreshBilling();
    } catch (cause) {
      failOrPaywall(cause, 'Could not analyse this photo.');
    } finally {
      setAnalyzing(null);
    }
  };

  // Service plans carry the trade slug on their SERVICES/REQUESTS
  // recommendations; engineer plans carry none. The slug decides whether
  // "Get quotes" and REQUESTS open provider booking or engineer requests.
  const serviceSlugFor = (value: Plan | null) =>
    value?.recommendations.find(item => item.action !== 'ENGINEERS' && item.query)?.query ?? null;

  const openServiceFromPlan = (serviceId: string) => {
    if (plan) setAiBookingPrefill(serviceId, plan.summary);
    // Plus express: skip the service detail screen and land directly on
    // providers with the plan prefilled; the booking carries Plus priority.
    if (billing?.effective) navigation.navigate('ServiceProviders', {serviceId, title: 'Recommended pros', fromAiPlan: true});
    else navigation.navigate('Services', {serviceId});
  };

  const getQuotes = () => {
    if (!plan) return;
    const slug = serviceSlugFor(plan);
    if (slug) openServiceFromPlan(slug);
    else navigation.navigate('EngineerDiscovery', {planId: plan.id});
  };

  const followRecommendation = (
    recommendation: Plan['recommendations'][number],
  ) => {
    if (recommendation.action === 'ENGINEERS')
      navigation.navigate('EngineerDiscovery');
    else if (recommendation.action === 'SERVICES') {
      if (recommendation.query) openServiceFromPlan(recommendation.query);
      else navigation.navigate('Services');
    } else if (recommendation.query) openServiceFromPlan(recommendation.query);
    else if (plan?.recommendations.some(item => item.action === 'SERVICES'))
      navigation.navigate('Services');
    else navigation.navigate('MainTabs', {screen: 'Requests'});
  };

  const exportPlan = async () => {
    if (!plan) return;
    setExporting(true);
    setError('');
    try {
      await createAndShareProjectBrief({
        ...plan,
        clientName: user?.fullName,
        city: user?.homeCity,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create the project brief. Please try again.',
      );
    } finally {
      setExporting(false);
    }
  };

  const quota = isApiConfigured ? quotaLabel(billing) : null;
  const plusEndDate = billing?.currentPeriodEnd
    ? new Date(billing.currentPeriodEnd).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})
    : null;
  const lastMessage = messages[messages.length - 1];
  const awaitingReply = busy && lastMessage?.type === 'USER_TEXT';

  useEffect(() => {
    if (messages.length) scroll.current?.scrollToEnd({animated: true});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (plan) scroll.current?.scrollToEnd({animated: true});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () =>
      scroll.current?.scrollToEnd({animated: true}),
    );
    return () => shown.remove();
  }, [scroll]);

  const filledDetails = [details, propertyType, budgetRange, timeline].filter(field => field.trim()).length;
  const detailSummary = [
    `${filledDetails} of 4 details`,
    `${documents.length} photo${documents.length === 1 ? '' : 's'}`,
    ...(plan ? [`plan v${plan.version}`] : []),
  ].join(' · ');

  if (!user)
    return (
      <View style={styles.root}>
        <AppHeader
          title="NAHTREEK AI"
          onBack={() => navigation.goBack()}
          showLogo
          compact
        />
        <ScrollView contentContainerStyle={styles.signIn}>
          <View style={styles.aiIcon}>
            <Icon name={ICONS.ai} size={32} color={AI_BRAND_COLOR} />
          </View>
          <Text style={styles.heading}>Keep your plan in one place</Text>
          <Text style={styles.copy}>
            Create an account to save plans, messages, photos, and next steps
            for your property.
          </Text>
          <Button
            label="Sign in to plan"
            onPress={() => navigation.navigate('Login')}
          />
        </ScrollView>
      </View>
    );

  return (
    <KeyboardAwareView style={styles.root}>
      <AppHeader
        title="NAHTREEK AI"
        onBack={() => navigation.goBack()}
        showLogo
        compact
      />
      <ScrollView
        style={styles.scroll}
        ref={scroll}
        onScroll={keyboardScroll.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={keyboardScroll.keyboardDismissMode}
        automaticallyAdjustKeyboardInsets>
        {activating ? (
          <View style={styles.billingRow}>
            <ActivityIndicator size="small" color={Colors.navyMid} />
            <Text style={styles.billingQuota}>Payment received — activating Plus…</Text>
          </View>
        ) : billing?.effective ? (
          <View style={styles.billingRow}>
            <Text style={styles.billingActive}>NAHTREEK Plus active</Text>
            {billing.cancelAtPeriodEnd ? (
              <>
                <Text style={styles.billingQuota}>Plus ends{plusEndDate ? ` ${plusEndDate}` : ''} — new cycle starts then</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Resubscribe to Plus"
                  onPress={() => void subscribe()} hitSlop={8} disabled={subscribing}>
                  <Text style={styles.billingCancel}>{subscribing ? 'Opening…' : 'Resubscribe'}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel AI subscription" onPress={cancel} hitSlop={8}>
                <Text style={styles.billingCancel}>Cancel</Text>
              </Pressable>
            )}
          </View>
        ) : quota ? (
          <View style={styles.billingRow}>
            <View style={styles.quotaPill}>
              <Icon name={ICONS.sparkles} size={13} color={Colors.navyDeep} />
              <Text style={styles.quotaText}>{quota}</Text>
            </View>
          </View>
        ) : null}
        {paywalled && !billing?.effective ? (
          <View style={styles.paywall}>
            <Text style={styles.paywallTitle}>Unlock unlimited NAHTREEK AI</Text>
            <Text style={styles.paywallCopy}>
              Your {plusPlan?.freeMessages ?? billing?.freeQuota ?? ''} free chats are used. {plusPrice} unlocks:
            </Text>
            <View style={styles.paywallBenefits}>
              <Text style={styles.paywallBenefit}>✓ Unlimited planning chats, in English or Tamil</Text>
              <Text style={styles.paywallBenefit}>✓ Step-by-step project plans you can share</Text>
              <Text style={styles.paywallBenefit}>✓ Photo analysis with urgency + questions to ask</Text>
              <Text style={styles.paywallBenefit}>✓ Plus badge professionals see on your requests</Text>
              <Text style={styles.paywallBenefit}>✓ Priority review if you report a payment problem</Text>
              <Text style={styles.paywallBenefit}>✓ Faster home service — late pros pay penalties</Text>
              <Text style={styles.paywallBenefit}>✓ {consultPerk}</Text>
            </View>
            <Button
              label={`Subscribe · ${plusPrice}`}
              loadingLabel="Opening checkout…"
              onPress={() => void subscribe()}
              loading={subscribing || activating}
              disabled={subscribing || activating}
            />
            {runtimeConfig.environment !== 'production' ? (
              <Button
                label="Activate free access"
                variant="secondary"
                loading={subscribing}
                disabled={subscribing}
                onPress={() => void demoActivate()}
              />
            ) : null}
          </View>
        ) : null}
        {!conversationId ? (
          <>
            <View style={styles.intro}>
              <View style={styles.introTop}>
                <View style={styles.aiIcon}>
                  <Icon name={ICONS.ai} size={24} color={AI_BRAND_COLOR} />
                </View>
                <Text style={styles.introEyebrow}>PROJECT PLANNING ASSISTANT</Text>
              </View>
              <Text style={styles.heading}>What are you planning?</Text>
              <Text style={styles.copy}>
                Choose the closest option. We will ask only for the details
                needed to organise your next steps.
              </Text>
            </View>
            {isApiConfigured && billing && !billing.effective ? (
              <View style={styles.proCard}>
                <View style={styles.proCopy}>
                  <Text style={styles.proTitle}>NAHTREEK Plus · {plusPrice}</Text>
                  <Text style={styles.proText}>
                    {quota ?? 'Free chats included'} — then unlimited chats, project plans, photo analysis, faster service with late penalties, engineer consult discounts and priority reviews.
                  </Text>
                </View>
                <Button
                  label="Subscribe"
                  loadingLabel="Opening checkout…"
                  onPress={() => void subscribe()}
                  loading={subscribing || activating}
                  disabled={subscribing || activating}
                />
                {runtimeConfig.environment !== 'production' ? (
                  <Button
                    label="Activate free access"
                    variant="secondary"
                    loading={subscribing}
                    disabled={subscribing}
                    onPress={() => void demoActivate()}
                  />
                ) : null}
              </View>
            ) : null}
            <View style={styles.choiceList}>
              {PROJECTS.map(project => (
                <ProjectChoice
                  key={project.type}
                  project={project}
                  index={PROJECTS.indexOf(project)}
                  busy={busy}
                  selected={startingType === project.type}
                  onPress={() => void start(project.type)}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={styles.strip}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={detailsExpanded ? 'Hide project details' : 'Show project details'}
                onPress={() => setDetailsExpanded(current => !current)}
                style={styles.stripMain}>
                <View style={styles.stripCopy}>
                  <Text style={styles.stripLabel}>
                    {isApiConfigured ? 'YOUR PROJECT' : 'PROJECT HELPER · ON THIS DEVICE'}
                  </Text>
                  <Text style={styles.stripTitle} numberOfLines={1}>
                    {PROJECTS.find(item => item.type === projectType)?.title}
                  </Text>
                  <Text style={styles.stripSummary} numberOfLines={1}>{detailSummary}</Text>
                </View>
                <View style={[styles.stripChevron, detailsExpanded && styles.stripChevronOpen]}>
                  <Icon name={ICONS.chevronDown} size={22} color={Colors.white} />
                </View>
              </Pressable>
              <View style={styles.langToggle}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reply in English"
                  accessibilityState={{selected: language === 'en'}}
                  onPress={() => setLanguage('en')}
                  style={styles.langOption}
                  hitSlop={8}>
                  <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>EN</Text>
                  {language === 'en' ? <View style={styles.langUnderline} /> : <View style={styles.langUnderlineIdle} />}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reply in Tamil"
                  accessibilityState={{selected: language === 'ta'}}
                  onPress={() => setLanguage('ta')}
                  style={styles.langOption}
                  hitSlop={8}>
                  <Text style={[styles.langText, language === 'ta' && styles.langTextActive]}>தமிழ்</Text>
                  {language === 'ta' ? <View style={styles.langUnderline} /> : <View style={styles.langUnderlineIdle} />}
                </Pressable>
              </View>
            </View>
            {detailsExpanded ? (
              <View style={styles.panel}>
            <Field
              label="Tell us about the work"
              value={details}
              onChangeText={setDetails}
              placeholder="Example: Renovate a 2BHK kitchen and two bathrooms"
              multiline
              onFocus={keyboardScroll.onFocus}
            />
            <View style={styles.twoFields}>
              <Field
                label="Property type"
                value={propertyType}
                onChangeText={setPropertyType}
                placeholder="Apartment, villa..."
                style={styles.flex}
                onFocus={keyboardScroll.onFocus}
              />
              <Field
                label="Budget range"
                value={budgetRange}
                onChangeText={setBudgetRange}
                placeholder="₹5–10 lakh"
                style={styles.flex}
                onFocus={keyboardScroll.onFocus}
              />
            </View>
            <Field
              label="Preferred start"
              value={timeline}
              onChangeText={setTimeline}
              placeholder="Within 3 months"
              onFocus={keyboardScroll.onFocus}
            />
            {rateCards.length ? (
              <View style={styles.rates}>
                <View style={styles.ratesHead}>
                  <Icon name={ICONS.currency} size={19} color={Colors.navyDeep} />
                  <Text style={styles.ratesTitle}>
                    Typical costs{user?.homeCity ? ` in ${user.homeCity}` : ''}
                  </Text>
                </View>
                {rateCards.slice(0, 8).map(card => (
                  <View key={card.serviceKey} style={styles.rateRow}>
                    <Text style={styles.rateLabel} numberOfLines={2}>{card.label}</Text>
                    <Text style={styles.rateValue}>{card.rangeLabel}</Text>
                  </View>
                ))}
                <Text style={styles.rateNote}>
                  Typical ranges. Your verified pro confirms the final price on visit.
                </Text>
              </View>
            ) : null}
            <View style={styles.uploadCard}>
              <View style={styles.choiceIcon}>
                <Icon name={ICONS.image} size={21} color={Colors.navyDeep} />
              </View>
              <View style={styles.choiceCopy}>
                <Text style={styles.choiceTitle}>Add a project photo</Text>
                <Text style={styles.choiceText}>
                  {documents.length
                    ? 'Tap Analyse on any photo and AI will explain what it sees, how urgent it is, and who to call.'
                    : isApiConfigured
                      ? 'Add a photo so AI can see the work, then tap Analyse for urgency and next steps.'
                      : 'Photos stay with your plan and help you explain the work to a professional.'}
                </Text>
              </View>
              <Pressable
                style={({pressed}) => [styles.uploadButton, pressed && styles.iconPressed]}
                accessibilityRole="button"
                accessibilityLabel="Add a project photo"
                onPress={() => void addPhoto()}
                disabled={busy}>
                <Icon name={ICONS.upload} size={19} color={ClientColors.onAccent} />
              </Pressable>
            </View>
            {documents.map(document => (
              <View key={document.id}>
                <View style={styles.document}>
                  <Icon name={ICONS.check} size={17} color={Colors.success} />
                  <Text style={styles.documentName} numberOfLines={1}>
                    {document.fileName}
                  </Text>
                  <Text style={styles.documentStatus}>
                    {document.status.toLowerCase()}
                  </Text>
                  {isApiConfigured && document.status === 'READY' ? (
                    <Pressable
                      style={styles.analyzeButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Analyse ${document.fileName}`}
                      onPress={() => void analyzePhoto(document.id)}
                      disabled={analyzing !== null}>
                      {analyzing === document.id ? (
                        <ActivityIndicator size="small" color={Colors.slate500} />
                      ) : (
                        <Text style={styles.analyzeText}>
                          {document.extractedSummary ? 'Re-analyse' : 'Analyse'}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
                {document.extractedSummary ? (
                  <Text style={styles.analysisSummary} numberOfLines={2}>
                    {document.extractedSummary}
                  </Text>
                ) : null}
              </View>
            ))}
            <Button
              label={plan ? 'Update plan' : 'Generate my plan'}
              variant="secondary"
              loading={busy}
              onPress={() => void createPlan()}
            />
            <Text style={styles.planHint}>
              Builds a structured plan from your details above. Chatting alone never changes the plan.
            </Text>
              </View>
            ) : null}
            <Text style={styles.chatLabel}>Chat with NAHTREEK AI</Text>
            {visibleMessages.map(item => {
                const fromUser = item.type === 'USER_TEXT';
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.message,
                      fromUser && styles.userMessage,
                    ]}>
                    {item.metadata?.kind === 'IMAGE_ANALYSIS' ? (
                      <Text style={styles.analysisBadge}>
                        Photo analysis{item.metadata.urgency ? ` · ${item.metadata.urgency}` : ''}
                      </Text>
                    ) : fromUser ? null : (
                      <View style={styles.aiLabelRow}>
                        <Icon name={ICONS.sparkles} size={13} color={AI_BRAND_COLOR} />
                        <Text style={styles.aiLabel}>NAHTREEK AI</Text>
                      </View>
                    )}
                    <RichMessageText content={item.content} user={fromUser} />
                  </View>
                );
              })}
            {awaitingReply ? (
              <View style={[styles.message, styles.typingBubble]}>
                <TypingDots />
              </View>
            ) : null}
            {plan ? (
              <PlanCard
                plan={plan}
                onAction={followRecommendation}
                onExport={() => void exportPlan()}
                exporting={exporting}
                onQuotes={isApiConfigured ? getQuotes : undefined}
                quotesLabel={billing?.effective ? 'Express book · Plus priority' : 'Get quotes for this plan'}
              />
            ) : null}
          </>
        )}
        {!conversationId && error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Text style={styles.note}>
          NAHTREEK AI gives planning guidance. A qualified professional must
          review structural, electrical, legal, and approval decisions.
        </Text>
      </ScrollView>
      {conversationId && user ? (
        <View style={styles.composerBar}>
          {visibleMessages.length === 0 ? (
            <View style={styles.chips}>
              {STARTER_CHIPS.map(chip => (
                <Pressable
                  key={chip}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask: ${chip}`}
                  onPress={() => void send(chip)}
                  disabled={busy}
                  style={({pressed}) => [styles.chip, pressed && styles.chipPressed]}>
                  <Text style={styles.chipText}>{chip}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <View style={styles.messageBox}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={listening ? 'Listening… speak now' : 'Ask about your project…'}
              placeholderTextColor={Colors.slate500}
              style={styles.messageInput}
            multiline
            onFocus={keyboardScroll.onFocus}
            />
            <Pressable
              onPress={() => void toggleVoice()}
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Stop voice input' : 'Speak your project detail'}
              style={({pressed}) => [styles.mic, listening && styles.micActive, pressed && styles.iconPressed]}>
              <Icon name={ICONS.mic} size={22} color={listening ? Colors.error : Colors.navyDeep} />
            </Pressable>
            <Pressable
              onPress={() => void send()}
              accessibilityRole="button"
              accessibilityLabel="Send project detail"
              disabled={busy || !message.trim()}
              style={({pressed}) => [styles.send, (busy || !message.trim()) && styles.sendDisabled, pressed && styles.iconPressed]}>
              <Icon name={ICONS.send} size={21} color={busy || !message.trim() ? Colors.slate400 : ClientColors.onAccent} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </KeyboardAwareView>
  );
}

function Field({
  label,
  style,
  ...props
}: {
  label: string;
  style?: object;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  onFocus?: TextInputProps['onFocus'];
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        onFocus={props.onFocus}
        placeholderTextColor={Colors.slate500}
        style={[styles.input, props.multiline && styles.multiline]}
      />
    </View>
  );
}
function PlanCard({
  plan,
  onAction,
  onExport,
  exporting,
  onQuotes,
  quotesLabel,
}: {
  plan: Plan;
  onAction: (recommendation: Plan['recommendations'][number]) => void;
  onExport: () => void;
  exporting: boolean;
  onQuotes?: () => void;
  quotesLabel?: string;
}) {
  return (
    <View style={styles.plan}>
      <View style={styles.planHead}>
        <View style={styles.choiceIcon}>
          <Icon name={ICONS.sparkles} size={21} color={AI_BRAND_COLOR} />
        </View>
        <View>
          <Text style={styles.planKicker}>
            YOUR PLAN · VERSION {plan.version}
          </Text>
          <Text style={styles.planTitle}>{plan.title}</Text>
        </View>
      </View>
      <Text style={styles.planSummary}>{plan.summary}</Text>
      <Text style={styles.subhead}>Recommended stages</Text>
      {plan.stages.map(stage => (
        <View style={styles.stage} key={stage.title}>
          <View style={styles.stageDot} />
          <View style={styles.choiceCopy}>
            <Text style={styles.stageTitle}>{stage.title}</Text>
            <Text style={styles.stageText}>{stage.detail}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.subhead}>Next actions</Text>
      {plan.recommendations.map(recommendation => (
        <Pressable
          key={recommendation.label}
          style={styles.recommendation}
          onPress={() => onAction(recommendation)}>
          <Text style={styles.recommendationText}>{recommendation.label}</Text>
          <Icon name={ICONS.chevronRight} color={Colors.navyDeep} />
        </Pressable>
      ))}
      <Text style={styles.subhead}>Checklist</Text>
      {plan.checklist.map(item => (
        <View key={item} style={styles.check}>
          <Icon name={ICONS.checkboxBlank} size={17} color={Colors.navyMid} />
          <Text style={styles.checkText}>{item}</Text>
        </View>
      ))}
      {plan.missingInformation.length ? (
        <Text style={styles.missing}>
          Still useful to confirm: {plan.missingInformation.join(', ')}.
        </Text>
      ) : null}
      {onQuotes ? (
        <Button label={quotesLabel ?? 'Get quotes for this plan'} onPress={onQuotes} />
      ) : null}
      <Button
        label="Save or share project brief"
        variant="secondary"
        loading={exporting}
        onPress={onExport}
      />
      <Text style={styles.safety}>{plan.safetyNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#F3F5F8'},
  scroll: {flex: 1},
  content: {padding: 20, paddingBottom: 40, gap: 16},
  strip: {
    backgroundColor: Colors.navyDeep,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stripMain: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8},
  stripCopy: {flex: 1, minWidth: 0},
  stripLabel: {...Typography.badge, color: ClientColors.white, letterSpacing: 1},
  stripTitle: {...Typography.subtitle, color: Colors.white, fontWeight: '700', marginTop: 2},
  stripSummary: {...Typography.caption, color: Colors.slate300, marginTop: 2},
  stripChevron: {flexShrink: 0},
  stripChevronOpen: {transform: [{rotate: '180deg'}]},
  panel: {gap: 16},
  planHint: {...Typography.caption, color: Colors.slate500, textAlign: 'center', marginTop: -8},
  composerBar: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.slate200,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  intro: {backgroundColor: Colors.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: ClientColors.border},
  introTop: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14},
  introEyebrow: {...Typography.badge, color: Colors.slate500, letterSpacing: 0.8},
  aiIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },
  heading: {...Typography.h1, color: Colors.slate900},
  copy: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.sm,
    lineHeight: 21,
  },
  billingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingVertical: 2,
    marginBottom: Spacing.md,
  },
  billingActive: {...Typography.caption, fontWeight: '700', color: Colors.success},
  billingQuota: {...Typography.caption, color: Colors.slate600},
  billingCancel: {...Typography.caption, fontWeight: '700', color: Colors.slate600, textDecorationLine: 'underline'},
  paywall: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: ClientColors.accent,
    borderRadius: 16,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  paywallTitle: {...Typography.subtitle, color: ClientColors.primaryNavy},
  paywallCopy: {...Typography.body, color: Colors.slate600, lineHeight: 21},
  paywallBenefits: {gap: 6},
  paywallBenefit: {...Typography.body, color: Colors.slate800, lineHeight: 20, fontWeight: '600'},
  proCard: {backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: ClientColors.border, gap: 12, alignSelf: 'stretch'},
  proCopy: {gap: 4},
  proTitle: {...Typography.subtitle, color: Colors.slate900, fontWeight: '700'},
  proText: {...Typography.caption, color: Colors.slate600, lineHeight: 18},
  choiceList: {gap: 10},
  choiceOuter: {borderRadius: 18},
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    minHeight: 86,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ClientColors.border,
  },
  choicePressed: {backgroundColor: ClientColors.accentSoft, borderColor: ClientColors.accent},
  choiceIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCopy: {flex: 1},
  choiceTitle: {
    ...Typography.subtitle,
    color: Colors.slate900,
    fontWeight: '700',
  },
  choiceText: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 2,
    lineHeight: 17,
  },
  context: {
    backgroundColor: Colors.navyDeep,
    borderRadius: 16,
    padding: 24,
  },
  contextTop: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  contextLabel: {...Typography.badge, color: ClientColors.white, letterSpacing: 1},
  langToggle: {flexDirection: 'row', gap: 16},
  langOption: {paddingVertical: 4, alignItems: 'center'},
  langText: {...Typography.caption, color: Colors.slate300, fontWeight: '700'},
  langTextActive: {color: Colors.white},
  langUnderline: {height: 2, borderRadius: 1, backgroundColor: ClientColors.accent, alignSelf: 'stretch', marginTop: 3},
  langUnderlineIdle: {height: 2, marginTop: 3, alignSelf: 'stretch'},
  contextTitle: {...Typography.h2, color: Colors.white, marginTop: Spacing.xs},
  contextText: {
    ...Typography.caption,
    color: Colors.slate300,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  field: {gap: Spacing.xs},
  fieldLabel: {
    ...Typography.caption,
    fontWeight: '700',
    color: Colors.slate800,
  },
  input: {
    minHeight: 48,
    ...Typography.body,
    color: Colors.slate900,
    backgroundColor: Colors.surface,
    borderColor: Colors.slate200,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
  },
  multiline: {minHeight: 80, textAlignVertical: 'top'},
  twoFields: {gap: 20},
  flex: {flex: 1},
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderColor: Colors.slate200,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  uploadButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ClientColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconPressed: {opacity: 0.75, transform: [{scale: 0.94}]},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    borderWidth: 1,
    borderColor: Colors.navyDeep,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipPressed: {backgroundColor: ClientColors.accentSoft, borderColor: ClientColors.accent},
  chipText: {...Typography.caption, color: Colors.navyDeep, fontWeight: '700'},
  document: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
  },
  documentName: {...Typography.caption, color: Colors.slate800, flex: 1},
  documentStatus: {...Typography.badge, color: Colors.slate500},
  analyzeButton: {paddingHorizontal: 4, paddingVertical: 8, alignItems: 'center'},
  analyzeText: {...Typography.caption, color: Colors.navyDeep, fontWeight: '700'},
  analysisSummary: {...Typography.caption, color: Colors.slate600, lineHeight: 17, marginTop: 4, marginLeft: 30},
  analysisBadge: {...Typography.badge, color: Colors.slate500, letterSpacing: 0.6, marginBottom: 6},
  rates: {backgroundColor: Colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.slate200, gap: 8},
  ratesHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  ratesTitle: {...Typography.subtitle, color: Colors.slate900, fontWeight: '700'},
  rateRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  rateLabel: {...Typography.caption, color: Colors.slate700, flex: 1, lineHeight: 17},
  rateValue: {...Typography.caption, color: Colors.slate900, fontWeight: '700'},
  rateNote: {...Typography.caption, color: Colors.slate500, lineHeight: 17},
  messageBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.xs,
  },
  messageInput: {
    ...Typography.body,
    color: Colors.slate900,
    flex: 1,
    maxHeight: 100,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ClientColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendDisabled: {backgroundColor: Colors.slate200},
  mic: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  micActive: {backgroundColor: ClientColors.accentSoft, borderWidth: 1, borderColor: Colors.error},
  message: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.slate200,
    shadowColor: '#0B1B33',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
    elevation: 1,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.navyDeep,
    borderColor: Colors.navyDeep,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 6,
  },
  messageText: {...Typography.caption, color: Colors.slate700, lineHeight: 18},
  userMessageText: {color: Colors.white},
  chatLabel: {...Typography.subtitle, color: Colors.slate900, fontWeight: '700', marginTop: Spacing.sm},
  aiLabelRow: {flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6},
  aiLabel: {...Typography.badge, color: Colors.navyDeep, letterSpacing: 0.6},
  richBold: {fontWeight: '700'},
  richBullet: {paddingLeft: 4},
  richLineGap: {marginTop: 6},
  typingBubble: {flexDirection: 'row', alignItems: 'center', gap: 8},
  typingText: {...Typography.caption, color: Colors.slate500, fontStyle: 'italic'},
  typingDots: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 2},
  typingDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.slate400},
  quotaPill: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ClientColors.accentSoft, borderWidth: 1, borderColor: ClientColors.accent, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 6},
  quotaText: {...Typography.caption, color: Colors.slate800, fontWeight: '700'},
  plan: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  planHead: {flexDirection: 'row', gap: Spacing.sm, alignItems: 'center'},
  planKicker: {
    ...Typography.badge,
    color: Colors.slate500,
    letterSpacing: 0.8,
  },
  planTitle: {...Typography.h3, color: Colors.slate900, marginTop: 2},
  planSummary: {
    ...Typography.body,
    color: Colors.slate700,
    marginTop: Spacing.md,
    lineHeight: 21,
  },
  subhead: {
    ...Typography.subtitle,
    color: Colors.slate900,
    fontWeight: '700',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  stage: {flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm},
  stageDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: Colors.navyDeep,
  },
  stageTitle: {
    ...Typography.caption,
    color: Colors.slate900,
    fontWeight: '700',
  },
  stageText: {
    ...Typography.caption,
    color: Colors.slate600,
    marginTop: 1,
    lineHeight: 17,
  },
  recommendation: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm + 2,
    marginBottom: Spacing.xs,
  },
  recommendationText: {
    flex: 1,
    ...Typography.caption,
    color: Colors.navyDeep,
    fontWeight: '700',
  },
  check: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
    alignItems: 'flex-start',
  },
  checkText: {
    ...Typography.caption,
    color: Colors.slate700,
    flex: 1,
    lineHeight: 18,
  },
  missing: {
    ...Typography.caption,
    color: Colors.slate600,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  safety: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  note: {
    ...Typography.caption,
    color: Colors.slate500,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  error: {...Typography.caption, color: Colors.error, lineHeight: 18},
  signIn: {padding: Spacing.xl, paddingTop: Spacing.xl + Spacing.sm, flexGrow: 1, justifyContent: 'flex-start', gap: Spacing.md},
});
