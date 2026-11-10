import React, {useState} from 'react';
import {ActivityIndicator, Alert, Image, NativeModules, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Colors} from '../design-system/src';
import {PaymentSection} from './PaymentSection';
import type {PaymentHooks} from './PaymentSection';
import {DateTimeField} from '../mobile-ui/DateTimeField';

type PlusTerms = {acceptWindowMs: number; arrivalGraceMs: number; lateAcceptPenaltyPaisa: number; lateArrivalPenaltyPaisa: number};
type Journey = {stage: string; revision: number; mode: string; recipientName: string; recipientPhone: string; expiresAt: string; scheduledAt?: string; arrivalTarget?: string; quoteAmount?: number; quoteScope?: string; quoteAccepted: boolean; collectionMode?: string; collectedAmountPaisa?: number; collectedMethod?: string; startCode?: string; completionSummary?: string; issue?: string; plusTerms?: PlusTerms | null; tracking?: {latitude: number; longitude: number; updatedAt: string; stale: boolean}};
const rupees = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN')}`;
type Props = {id: string; client: boolean; load: () => Promise<Journey>; act: (body: any) => Promise<unknown>; beforeAction?: (action: string) => Promise<unknown>; payment?: PaymentHooks; receiptEmail?: string | null; onSaveReceiptEmail?: (email: string) => Promise<unknown>; isPlus?: boolean; clientPlus?: boolean; onFindAnother?: () => void};
function countdownTo(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'}`;
}
const names: Record<string,string> = {PENDING: 'Waiting for acceptance', ACCEPTED: 'Visit accepted', EN_ROUTE: 'Professional is on the way', ARRIVED: 'Professional has arrived', IN_PROGRESS: 'Work in progress', AWAITING_CONFIRMATION: 'Please confirm the completed work', COMPLETED: 'Service completed', CANCELLED: 'Booking cancelled', DECLINED: 'Professional declined', EXPIRED: 'Request expired', DISPUTED: 'Issue reported — not completed'};
const journeyStages=[['PENDING','Requested'],['ACCEPTED','Accepted'],['EN_ROUTE','On the way'],['ARRIVED','Arrived'],['IN_PROGRESS','Working'],['AWAITING_CONFIRMATION','Review'],['COMPLETED','Complete']] as const;
const clientStageGuidance: Record<string,string> = {
  PENDING:'The professional has been notified. This visit is not confirmed until they accept.',
  ACCEPTED:'The professional accepted. They have not started the journey yet.',
  EN_ROUTE:'The professional has started the journey. Arrival time and location are estimates.',
  ARRIVED:'Confirm the work scope and price before work begins. Share the start code only at the correct address.',
  IN_PROGRESS:'Work is underway. Any change to the agreed scope or price needs your approval.',
  AWAITING_CONFIRMATION:'Review the completion summary. Confirm only if the agreed work is complete, or report a problem.',
  COMPLETED:'The service is marked complete. Payment is handled separately from this booking flow.',
  CANCELLED:'This booking was cancelled. It will remain in your request history.',
  DECLINED:'The professional declined this request. No replacement is assigned automatically.',
  EXPIRED:'The request expired before it was accepted. Submit a new request to check availability again.',
  DISPUTED:'A problem was reported. The booking remains open for support review.',
};
const professionalStageGuidance: Record<string,string> = {
  PENDING:'Review the customer’s request and address. Accept only if you can take this work.',
  ACCEPTED:'You accepted this request. Start the journey when you are heading to the customer.',
  EN_ROUTE:'You are on the way. Keep location sharing active so the customer can follow the trip.',
  ARRIVED:'Agree the scope and price with the customer. Verify the start code before beginning work.',
  IN_PROGRESS:'Keep the customer informed. Get approval before changing the agreed scope or price.',
  AWAITING_CONFIRMATION:'The completion summary is submitted. The customer must confirm the work or report a problem.',
  COMPLETED:'The customer confirmed completion. Payment is handled separately from this booking flow.',
  CANCELLED:'This booking was cancelled and remains in request history.',
  DECLINED:'You declined this request. It was not assigned to another professional.',
  EXPIRED:'The request expired before acceptance. It was not assigned to another professional.',
  DISPUTED:'The customer reported a problem. The booking remains open for support review.',
};
function actionConfirmation(action:string,j:Journey,amount:string,note:string,paymentsOn:boolean,collectMode:string,collectAmount:string,collectMethod:string,client:boolean) {
  if(action==='QUOTE')return `Send a quote of ₹${Number(amount).toLocaleString('en-IN')} for this scope?\n\n${note.trim()}\n\nThe customer must approve it before work starts or the price changes.`;
  if(action==='APPROVE_QUOTE')return `Approve ₹${j.quoteAmount?.toLocaleString('en-IN')} for this scope?\n\n${j.quoteScope ?? ''}\n\n${collectMode==='AT_HOME' ? 'You will pay the professional directly at home (cash or UPI) after the work.' : 'You will pay online now; the money releases to the professional when you confirm completion.'}\n\nOnly approve if you agree with both the amount and the described work.`;
  if(action==='START')return 'Start work only after the customer has approved the quote and you have verified their six-digit code at the service address.';
  if(action==='FINISH')return j.collectionMode==='AT_HOME' ? `Submit this completion summary and record ₹${Number(collectAmount).toLocaleString('en-IN')} collected by ${collectMethod}?\n\n${note.trim()}\n\nThe customer will review the work and the collected amount before the request is marked complete.` : `Submit this completion summary to the customer?\n\n${note.trim()}\n\nThe customer will review it before the request is marked complete.`;
  if(action==='CONFIRM')return j.collectionMode==='AT_HOME' && j.collectedAmountPaisa ? `Confirm only if the agreed work is complete and you paid ₹${(j.collectedAmountPaisa/100).toLocaleString('en-IN')} by ${j.collectedMethod} at home. If the amount is wrong, report a problem instead.` : paymentsOn ? 'Confirm only if the agreed work is complete. This marks the service complete and releases the held payment to the professional.' : 'Confirm only if the agreed work is complete. This marks the service request complete; it does not record an online payment.';
  if(action==='ISSUE')return `Send this issue report to the professional?\n\n${note.trim()}`;
  if(action==='CANCEL')return client ? 'Cancel this booking? The professional will be notified. If you already paid, the held amount is refunded automatically.' : 'Cancel this booking? The customer will be notified and any payment is refunded automatically. Only cancel for a genuine reason — reliability affects your ranking.';
  if(action==='DECLINE')return 'Decline this request? The client will be notified, and no replacement will be assigned automatically.';
  if(action==='ACCEPT')return 'Accept this visit? Make sure you can take the work and reach the service address.';
  if(action==='DEPART')return 'Start sharing your journey to the service address? The client will be able to see your location while you are on the way.';
  if(action==='ARRIVE')return 'Confirm that you are at the service address. Your location is checked before arrival is recorded.';
  if(action==='RESCHEDULE')return 'Move this visit to the new time? The professional will be notified and must still accept.';
  return 'The other person will receive this update.';
}
export function JourneyPanel({id, client, load, act, beforeAction, payment, receiptEmail, onSaveReceiptEmail, isPlus, clientPlus, onFindAnother}: Props) {
  const cache = useQueryClient();
  const [note, setNote] = useState(''); const [amount, setAmount] = useState(''); const [code, setCode] = useState(''); const [newTime, setNewTime] = useState<Date | null>(null);
  const parsedNewTime = newTime;
  const validNewTime = Boolean(parsedNewTime && parsedNewTime.getTime() >= Date.now() + 30 * 60000 && parsedNewTime.getTime() <= Date.now() + 30 * 86400000);
  const [collectMode, setCollectMode] = useState('ONLINE'); const [collectAmount, setCollectAmount] = useState(''); const [collectMethod, setCollectMethod] = useState('CASH');
  const q = useQuery({queryKey: ['service-journey', id], queryFn: load, refetchInterval: 3000, refetchIntervalInBackground: false, retry: 1});
  const mutation = useMutation({mutationFn: async (action: string) => {
    await beforeAction?.(action);
    return act({action, revision: q.data!.revision, ...(note.trim() ? {note: note.trim()} : {}), ...(action === 'QUOTE' && amount.trim() ? {amount: Number(amount)} : {}), ...(action === 'START' ? {code} : {}), ...(action === 'APPROVE_QUOTE' ? {collectionMode: collectMode} : {}), ...(action === 'FINISH' && q.data!.collectionMode === 'AT_HOME' ? {collectedAmountPaisa: Math.round(Number(collectAmount) * 100), collectedMethod: collectMethod} : {}), ...(action === 'RESCHEDULE' && parsedNewTime ? {scheduledAt: parsedNewTime.toISOString()} : {})});
  }, onSuccess: () => {
    setCode(''); setNote(''); setAmount(''); setCollectAmount(''); setNewTime(null);
    const keys = client
      ? [['service-journey', id], ['service-request'], ['service-requests'], ['history/me'], ['request-detail', id], ['providers']]
      : [['service-journey', id], ['professional-request-detail', 'service', id], ['professional-requests'], ['professional-request-summary']];
    void Promise.all(keys.map(queryKey => cache.invalidateQueries({queryKey})));
  }, onError: () => {void q.refetch();}});
  if (!q.data) return <View style={s.card}>{q.isPending ? <ActivityIndicator /> : <><Text style={s.error}>Could not load the live booking. Your booking has not been changed.</Text><Pressable accessibilityRole="button" disabled={q.isFetching} onPress={()=>void q.refetch()}><Text style={s.retryText}>{q.isFetching?'Checking…':'Try loading again'}</Text></Pressable></>}</View>;
  const j=q.data; const closed=['COMPLETED','CANCELLED','DECLINED','EXPIRED'].includes(j.stage);
  const currentStage=Math.max(0,journeyStages.findIndex(([stage])=>stage===j.stage));
  const showProgress=journeyStages.some(([stage])=>stage===j.stage);
  const actions: [string,string][] = client ? [
    ...(['PENDING','ACCEPTED'].includes(j.stage) ? [['RESCHEDULE','Change visit time'] as [string,string]] : []),
    ...(['ARRIVED','IN_PROGRESS'].includes(j.stage) && j.quoteAmount != null && !j.quoteAccepted ? [['APPROVE_QUOTE','Approve scope and price'] as [string,string]] : []),
    ...(j.stage==='AWAITING_CONFIRMATION' ? [['CONFIRM','Confirm work completed'] as [string,string]] : []),
    ...(j.stage==='DISPUTED' ? [['CONFIRM','Mark resolved — release payment'] as [string,string]] : []),
    ...(['IN_PROGRESS','AWAITING_CONFIRMATION'].includes(j.stage) ? [['ISSUE','Report a problem'] as [string,string]] : []),
  ] : j.stage==='PENDING' ? [['ACCEPT','Accept this visit'],['DECLINE','Decline']] : j.stage==='ACCEPTED' ? [['DEPART','Start journey'],['CANCEL','Cancel booking']] : j.stage==='EN_ROUTE' ? [['ARRIVE','I have arrived']] : j.stage==='ARRIVED' ? [['QUOTE','Send work scope and price'],['START','Verify code and start work']] : j.stage==='IN_PROGRESS' ? [['QUOTE','Request approval for revised scope/price'],['FINISH','Submit completed work']] : [];
  if (client && ['PENDING','ACCEPTED','EN_ROUTE','ARRIVED'].includes(j.stage)) actions.push(['CANCEL','Cancel booking']);
  const canSubmitAction=(action:string)=>{
    if(action==='QUOTE')return Number.isFinite(Number(amount))&&Number(amount)>0&&note.trim().length>=10;
    if(action==='START')return j.quoteAccepted&&/^\d{6}$/.test(code.trim());
    if(action==='FINISH')return j.quoteAccepted&&note.trim().length>=10&&(j.collectionMode!=='AT_HOME'||(Number.isFinite(Number(collectAmount))&&Number(collectAmount)>=1&&(collectMethod==='CASH'||collectMethod==='UPI')));
    if(action==='ISSUE')return note.trim().length>=10;
    if(action==='RESCHEDULE')return validNewTime;
    return true;
  };
  const refreshStatus=()=>{void q.refetch().then(result=>{if(!result.isError)mutation.reset();});};
  const actionError=mutation.error as (Error & {status?:number;kind?:string})|null;
  const prerequisiteFailed=actionError?.kind==='prerequisite';
  const actionsBlocked=mutation.isPending||q.isRefetchError||Boolean(mutation.error&&!prerequisiteFailed);
  const needsNoteInput=(!client&&['ARRIVED','IN_PROGRESS'].includes(j.stage))||(client&&['IN_PROGRESS','AWAITING_CONFIRMATION'].includes(j.stage));
  return <View style={s.card}>
    <Text style={s.heading}>{names[j.stage] ?? j.stage}</Text>
    <Text style={q.isRefetchError?s.connectionWarning:s.small}>{q.isRefetchError ? `Connection interrupted. Showing the last update received at ${new Date(q.dataUpdatedAt).toLocaleTimeString()}.` : `Live updates · synced ${new Date(q.dataUpdatedAt).toLocaleTimeString()}`}</Text>
    {q.isRefetchError?<Pressable accessibilityRole="button" accessibilityLabel="Retry refreshing booking status" disabled={q.isFetching} onPress={refreshStatus}><Text style={s.retryText}>{q.isFetching?'Refreshing status…':'Retry status refresh'}</Text></Pressable>:null}
    <View style={s.stageNote}><Text style={s.text}>{(client?clientStageGuidance:professionalStageGuidance)[j.stage] ?? 'Your request status will update here.'}</Text></View>
    {client && isPlus && ['PENDING','ACCEPTED','EN_ROUTE','ARRIVED'].includes(j.stage) ? <View style={s.plusNote}><Text style={s.text}>Plus priority active — your provider must accept fast, and lateness penalties protect this booking.</Text></View> : null}
    {!client && clientPlus && ['PENDING','ACCEPTED','EN_ROUTE'].includes(j.stage) ? <View style={s.plusNote}><Text style={s.text}>Plus priority client — accept and arrive fast.{j.plusTerms ? ` Slow acceptance costs ${rupees(j.plusTerms.lateAcceptPenaltyPaisa)}, late arrival ${rupees(j.plusTerms.lateArrivalPenaltyPaisa)} from your dues.` : ' Slow acceptance and late arrival add penalties to your dues.'}</Text></View> : null}
    {showProgress?<View accessibilityLabel={`Booking progress: ${names[j.stage] ?? j.stage}`} style={s.progress}>{journeyStages.map(([stage,label],index)=>{
      const complete=index<currentStage; const current=index===currentStage;
      return <View key={stage} style={s.progressRow}>
        <View style={s.progressTrack}>{index>0?<View style={[s.progressLine,index<=currentStage&&s.progressLineDone]}/>:null}<View style={[s.progressDot,complete&&s.progressDotDone,current&&s.progressDotCurrent]}/></View>
        <Text accessibilityLabel={`${label}, ${complete?'complete':current?'current':'upcoming'}`} style={[s.progressLabel,current&&s.progressLabelCurrent,complete&&s.progressLabelDone]}>{label}</Text>
      </View>;
    })}</View>:null}
    <Text style={s.text}>Recipient: {j.recipientName} · {j.recipientPhone}</Text>
    {j.scheduledAt ? <Text style={s.text}>Visit: {new Date(j.scheduledAt).toLocaleString()}{countdownTo(j.scheduledAt) ? ` (in ${countdownTo(j.scheduledAt)})` : ''}</Text> : null}
    {j.stage==='PENDING' ? <Text style={s.text}>Respond by {new Date(j.expiresAt).toLocaleTimeString()}{countdownTo(j.expiresAt) ? ` (in ${countdownTo(j.expiresAt)})` : ' — overdue, a replacement may be needed'}.</Text> : null}
    {j.arrivalTarget && ['ACCEPTED','EN_ROUTE'].includes(j.stage) ? <Text style={s.text}>Estimated arrival: {new Date(j.arrivalTarget).toLocaleTimeString()}{countdownTo(j.arrivalTarget) ? ` (in ${countdownTo(j.arrivalTarget)})` : ''}. {new Date(j.arrivalTarget).getTime()<Date.now() ? 'The estimate has passed. Contact the professional for an update.' : 'Estimate only; road conditions may change.'}</Text> : null}
    {client && ['DECLINED','EXPIRED'].includes(j.stage) && onFindAnother ? <Pressable accessibilityRole="button" accessibilityLabel="Find another professional" onPress={onFindAnother} style={s.button}><Text style={s.buttonText}>Find another professional</Text></Pressable> : null}
    {client && j.tracking ? <LivePin tracking={j.tracking} /> : null}
    {client && !j.tracking && ['ACCEPTED','EN_ROUTE'].includes(j.stage) ? <View style={s.stageNote}><Text style={s.text}>{j.stage === 'EN_ROUTE' ? 'The professional is on the way, but no live location has arrived yet. Ask them to keep location sharing switched on.' : 'The live tracking map appears here once the professional starts the journey.'}</Text></View> : null}
    {j.quoteAmount != null ? <View style={s.info}><Text style={s.heading}>₹{j.quoteAmount.toLocaleString('en-IN')}</Text><Text style={s.text}>{j.quoteScope}</Text><Text style={s.small}>{j.quoteAccepted ? `Customer approved this scope and price${j.collectionMode==='AT_HOME' ? ', pay at home.' : '.'}` : 'Awaiting customer approval. Do not start additional work.'}</Text></View> : null}
    {j.collectedAmountPaisa != null ? <View style={s.info}><Text style={s.heading}>₹{(j.collectedAmountPaisa/100).toLocaleString('en-IN')} collected by {j.collectedMethod}</Text><Text style={s.small}>{client ? 'Check this matches what you paid at home. If it is wrong, report a problem instead of confirming.' : 'Recorded as collected at home. The platform commission is tracked as your dues.'}</Text></View> : null}
    {client && j.quoteAccepted && j.quoteAmount != null && payment && j.collectionMode !== 'AT_HOME' ? <PaymentSection requestId={id} quoteAmount={j.quoteAmount} hooks={payment} receiptEmail={receiptEmail} onSaveReceiptEmail={onSaveReceiptEmail} /> : null}
    {client && j.quoteAccepted && j.collectionMode === 'AT_HOME' ? <View style={s.stageNote}><Text style={s.text}>Pay at home: give ₹{j.quoteAmount?.toLocaleString('en-IN')} to the professional in cash or UPI after the work. The amount they record must match what you paid.</Text></View> : null}
    {j.startCode ? <View style={s.info}><Text style={s.heading}>Service-start code: {j.startCode}</Text><Text style={s.text}>Share only when the professional is at the correct address and you approve the work. For someone else, share it privately with the recipient.</Text></View> : null}
    {j.completionSummary ? <Text style={s.text}>Work summary: {j.completionSummary}</Text> : null}
    {j.issue ? <Text style={s.error}>Reported issue: {j.issue}. This booking remains open for support review.</Text> : null}
    {!closed && needsNoteInput ? <>
      <Text style={s.inputLabel}>{client?(j.stage==='AWAITING_CONFIRMATION'?'Optional note if you report a problem':'Describe the problem'):j.stage==='ARRIVED'?'Agreed work scope and inclusions':'Completion summary or revised scope'}</Text>
      <TextInput accessibilityLabel={client?(j.stage==='AWAITING_CONFIRMATION'?'Optional note about the completed work':'Describe the problem'):j.stage==='ARRIVED'?'Agreed work scope and inclusions':'Completion summary or revised scope'} style={[s.input,s.multilineInput]} multiline placeholder={client?'Add details here (10 characters minimum for a problem report)':'Describe clearly (at least 10 characters)'} value={note} onChangeText={setNote} maxLength={2000}/>
      {!client && ['ARRIVED','IN_PROGRESS'].includes(j.stage) ? <TextInput accessibilityLabel="Total price" style={s.input} placeholder="Total agreed price in rupees" keyboardType="decimal-pad" value={amount} onChangeText={setAmount}/> : null}
      {!client && j.stage==='ARRIVED' ? <TextInput accessibilityLabel="Service-start code" style={s.input} placeholder="Customer's 6-digit start code" keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6}/> : null}
      {!client&&j.stage==='ARRIVED'&&!j.quoteAccepted?<Text style={s.small}>Send the scope and price first. Work can start only after the client approves and you verify their code.</Text>:null}
      {!client&&j.stage==='IN_PROGRESS'?<Text style={s.small}>Changes to the agreed scope or price need customer approval before you continue.</Text>:null}
    </> : null}
    {client && !closed && ['PENDING','ACCEPTED'].includes(j.stage) ? <View>
      <DateTimeField label="New visit time (local)" accessibilityLabel="New visit date and time" value={newTime} onChange={setNewTime} minimumDate={new Date(Date.now() + 30 * 60000)} maximumDate={new Date(Date.now() + 30 * 86400000)} />
      {newTime && !validNewTime ? <Text style={s.small}>Visits must be 30 minutes to 30 days from now.</Text> : null}
    </View> : null}
    {client && !closed && ['ARRIVED','IN_PROGRESS'].includes(j.stage) && j.quoteAmount != null && !j.quoteAccepted ? <View>
      <Text style={s.inputLabel}>How will you pay?</Text>
      <View style={s.chipRow}>
        {([['ONLINE','Pay online now'],['AT_HOME','Pay at home']] as [string,string][]).map(([value,label])=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:collectMode===value}} onPress={()=>setCollectMode(value)} style={[s.chip,collectMode===value&&s.chipOn]}><Text style={[s.chipText,collectMode===value&&s.chipTextOn]}>{label}</Text></Pressable>)}
      </View>
      <Text style={s.small}>{collectMode==='AT_HOME' ? 'Pay the professional directly in cash or UPI after the work. They will record the amount here.' : 'Pay securely online. The money releases to the professional only when you confirm completion.'}</Text>
    </View> : null}
    {!client && !closed && j.stage==='IN_PROGRESS' && j.collectionMode==='AT_HOME' ? <View>
      <Text style={s.inputLabel}>Amount collected at home (₹)</Text>
      <TextInput accessibilityLabel="Amount collected at home in rupees" style={s.input} placeholder="e.g. 2000" keyboardType="decimal-pad" value={collectAmount} onChangeText={setCollectAmount}/>
      <View style={s.chipRow}>
        {(['CASH','UPI'] as string[]).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:collectMethod===value}} onPress={()=>setCollectMethod(value)} style={[s.chip,collectMethod===value&&s.chipOn]}><Text style={[s.chipText,collectMethod===value&&s.chipTextOn]}>{value==='CASH'?'Cash':'UPI'}</Text></Pressable>)}
      </View>
    </View> : null}
    {mutation.error ? <View accessibilityRole="alert" style={s.actionError}><Text style={s.error}>{prerequisiteFailed ? actionError?.message : actionError?.status===0||actionError?.kind==='network'||actionError?.kind==='timeout'?'We could not confirm whether that update reached the server. Refresh the booking status before trying again.':actionError?.message ?? 'Could not update the booking.'}</Text><Pressable accessibilityRole="button" disabled={q.isFetching} onPress={prerequisiteFailed?()=>mutation.reset():refreshStatus}><Text style={s.retryText}>{prerequisiteFailed?'Dismiss':q.isFetching?'Checking booking…':'Refresh booking status'}</Text></Pressable></View> : null}
    {actions.map(([action,label])=><Pressable accessibilityRole="button" accessibilityState={{disabled:actionsBlocked||!canSubmitAction(action),busy:mutation.isPending}} key={action} disabled={actionsBlocked || !canSubmitAction(action)} style={[s.button, (action==='CANCEL'||action==='DECLINE'||action==='ISSUE') && s.secondary, (actionsBlocked||!canSubmitAction(action)) && {opacity:0.5}]} onPress={()=>Alert.alert(label, actionConfirmation(action,j,amount,note,Boolean(payment),collectMode,collectAmount,collectMethod,client), [{text:'Not now',style:'cancel'},{text:label,onPress:()=>mutation.mutate(action)}])}><Text style={s.buttonText}>{mutation.isPending ? 'Updating…' : label}</Text></Pressable>)}
    <Text style={s.small}>{j.collectionMode==='AT_HOME' ? 'Pay-at-home booking: the professional collects at the door and the platform commission is tracked as their dues.' : payment ? 'Payments are held securely and released to the professional when you confirm the completed work.' : 'Service progress and payment are separate. No online payment is collected on this screen.'}</Text>
  </View>;
}
function LivePin({tracking}: {tracking: NonNullable<Journey['tracking']>}) {
  const q=useQuery({queryKey:['live-map',tracking.latitude,tracking.longitude],queryFn:()=>NativeModules.NahtreekRuntimeConfig.getStaticMapUrl(tracking.latitude,tracking.longitude) as Promise<string>,retry:0});
  const [failed,setFailed]=useState(false);
  const retry=()=>{setFailed(false);void q.refetch();};
  const position=`${tracking.latitude.toFixed(4)}, ${tracking.longitude.toFixed(4)}`;
  return <View><Text style={s.text}>{tracking.stale ? 'Location is stale — do not rely on this position.' : 'Professional’s latest location'}</Text><Text style={s.small}>Updated {new Date(tracking.updatedAt).toLocaleTimeString()}</Text>{q.isPending ? <Text style={s.small}>Loading the live map…</Text> : q.data && !failed ? <View style={s.map}><Image source={{uri:q.data}} style={s.map} onError={()=>setFailed(true)}/><View style={s.pin}/></View> : <Pressable accessibilityRole="button" accessibilityLabel="Retry loading the tracking map" onPress={retry}><Text style={s.small}>Map image unavailable — tap to retry. Last position {position}.</Text></Pressable>}</View>;
}
const s=StyleSheet.create({card:{padding:16,gap:12,backgroundColor:Colors.white,borderRadius:18,borderWidth:1,borderColor:Colors.slate200},heading:{fontSize:18,fontWeight:'700',color:Colors.navyDeep},text:{fontSize:15,lineHeight:22,color:Colors.slate800},small:{fontSize:12,lineHeight:18,color:Colors.slate500},connectionWarning:{fontSize:13,lineHeight:19,color:Colors.warning,backgroundColor:Colors.warningBg,padding:10,borderRadius:10},error:{color:Colors.error,lineHeight:21},actionError:{padding:12,gap:8,borderRadius:12,backgroundColor:Colors.errorBg},retryText:{fontSize:14,fontWeight:'700',color:Colors.navyMid,paddingVertical:8},stageNote:{padding:12,backgroundColor:Colors.offWhite,borderRadius:12},plusNote:{padding:12,backgroundColor:Colors.softBlue,borderRadius:12},progress:{gap:0,paddingVertical:4},progressRow:{minHeight:30,flexDirection:'row',alignItems:'center',gap:10},progressTrack:{width:18,height:30,alignItems:'center',justifyContent:'center'},progressLine:{position:'absolute',top:0,bottom:0,width:2,backgroundColor:Colors.slate200},progressLineDone:{backgroundColor:Colors.success},progressDot:{width:10,height:10,borderRadius:5,backgroundColor:Colors.slate300,zIndex:1},progressDotDone:{backgroundColor:Colors.success},progressDotCurrent:{width:14,height:14,borderRadius:7,backgroundColor:Colors.amber,borderWidth:2,borderColor:Colors.navyDeep},progressLabel:{fontSize:13,color:Colors.slate500},progressLabelCurrent:{fontWeight:'700',color:Colors.navyDeep},progressLabelDone:{color:Colors.success},info:{backgroundColor:Colors.softBlue,padding:12,borderRadius:12,gap:8},inputLabel:{fontSize:14,fontWeight:'600',color:Colors.slate700},input:{minHeight:52,padding:12,borderWidth:1,borderColor:Colors.slate200,borderRadius:12,color:Colors.slate900},multilineInput:{minHeight:90,textAlignVertical:'top'},chipRow:{flexDirection:'row',gap:8,marginVertical:8},chip:{flex:1,paddingVertical:12,paddingHorizontal:8,borderRadius:12,borderWidth:1,borderColor:Colors.slate200,alignItems:'center'},chipOn:{backgroundColor:Colors.navyDeep,borderColor:Colors.navyDeep},chipText:{fontSize:14,fontWeight:'600',color:Colors.slate700},chipTextOn:{color:Colors.white},button:{backgroundColor:Colors.amber,borderRadius:12,minHeight:50,padding:14,justifyContent:'center'},secondary:{backgroundColor:Colors.slate100},buttonText:{color:Colors.navyDeep,fontWeight:'700',textAlign:'center'},map:{height:220,width:'100%',borderRadius:12,overflow:'hidden'},pin:{position:'absolute',left:'50%',top:'50%',width:16,height:16,marginLeft:-8,marginTop:-8,backgroundColor:Colors.amber,borderWidth:3,borderColor:Colors.navyDeep,borderRadius:8}});
