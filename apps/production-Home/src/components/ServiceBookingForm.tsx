import React, {useRef, useState} from 'react';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {Colors, IndiaLocale, Typography} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {Button, Icon, ICONS, Input} from './ui';
import {DateTimeField} from '../../../../packages/mobile-ui/DateTimeField';
import {LocationPicker} from './LocationPicker';
import {PlusPerkStrip} from './PlusPerkStrip';
import {api} from '../services/apiClient';
import {takeAiBookingPrefill} from '../services/aiBookingPrefill';
import type {SelectedLocation} from '../services/location';
import {platformStyles as s} from '../screens/PlatformHistoryScreen';

type Match={id:string;fullName:string;distanceKm:number;etaMinutes:number|null;startingPrice?:number};
// Collision-resistant submission identifier, not a credential or an authorization token.
const submissionId=()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return(c==='x'?n:(n&3)|8).toString(16);});
export function ServiceBookingForm({serviceId, preferred, onBooked}: {serviceId:string;preferred?:{id:string;fullName:string};onBooked:(id:string)=>void}) {
  const cache=useQueryClient(); const key=useRef(submissionId()); const pending=useRef<any>(null);
  const matchVersion=useRef(0);
  const [location,setLocation]=useState<SelectedLocation|null>(null);const[description,setDescription]=useState(()=>takeAiBookingPrefill(serviceId) ?? '');const[address,setAddress]=useState('');
  const[name,setName]=useState('');const[phone,setPhone]=useState('');const[consent,setConsent]=useState(false);const[mode,setMode]=useState<'ASAP'|'SCHEDULED'>('ASAP');const[schedule,setSchedule]=useState<Date|null>(null);
  const [automatic,setAutomatic]=useState(!preferred);const[matches,setMatches]=useState<Match[]>([]);const[chosen,setChosen]=useState<string|null>(null);
  const [review,setReview]=useState(false);
  const reset=()=>{matchVersion.current++;search.reset();setMatches([]);setChosen(null);setReview(false);key.current=submissionId();pending.current=null;};
  const search=useMutation({mutationFn:(request:{version:number;latitude:number;longitude:number;mode:'ASAP'|'SCHEDULED';professionalProfileId?:string})=>api.post<{data:Match[]}>('/service-workflow/matches',{serviceId,latitude:request.latitude,longitude:request.longitude,mode:request.mode,...(request.professionalProfileId?{professionalProfileId:request.professionalProfileId}:{})}),onSuccess:(r,request)=>{if(request.version===matchVersion.current){setMatches(r.data);setChosen(r.data[0]?.id??null);}}});
  const book=useMutation({mutationFn:()=>api.post<{id:string}>('/service-workflow/book',pending.current),onSuccess:r=>{void cache.invalidateQueries();onBooked(r.id);}});
  const locked=book.isPending || Boolean(book.isError && pending.current);
  // The native picker returns a real Date, so no format parsing or digit
  // validation remains — only the booking window still needs checking.
  const parsedSchedule=schedule;
  const validSchedule=Boolean(parsedSchedule&&parsedSchedule.getTime()>=Date.now()+30*60000&&parsedSchedule.getTime()<=Date.now()+30*86400000);
  const scheduledLabel=mode==='SCHEDULED'&&validSchedule?parsedSchedule!.toLocaleString():null;
  function submit(){
    if(!location||!chosen)return;
    if(pending.current){book.mutate();return;}
    if(mode==='SCHEDULED'&&!validSchedule)return;
    const scheduled=mode==='SCHEDULED'?parsedSchedule:null;
    if(!pending.current)pending.current={serviceId,professionalProfileId:chosen,latitude:location.latitude,longitude:location.longitude,mode,
      idempotencyKey:key.current,description:description.trim(),locationAddress:`${address.trim()}, ${location.address}`,recipientName:name.trim(),recipientPhone:phone.replace(/[\s()-]/g,''),recipientConsent:consent,...(scheduled?{scheduledAt:scheduled.toISOString()}: {})};
    setReview(true);
  }
  const chosenMatch=matches.find(m=>m.id===chosen);
  return <View style={{gap:14}}>
    {review&&pending.current?<>
      <View style={styles.reviewHeader}><Text style={styles.reviewEyebrow}>REVIEW REQUEST</Text><Text accessibilityRole="header" style={styles.reviewTitle}>Check everything before sending</Text><Text style={styles.reviewBody}>This is a request, not a confirmed booking. The professional must accept it.</Text></View>
      <View style={styles.reviewCard}>
        <ReviewRow label="Professional" value={chosenMatch?.fullName??'Selected professional'}/>
        <ReviewRow label="Service" value={description.trim()}/>
        <ReviewRow label="Service address" value={pending.current.locationAddress}/>
        <ReviewRow label="Person at address" value={`${name.trim()} · ${phone.trim()}`}/>
        <ReviewRow label="Visit time" value={mode==='ASAP'?`As soon as possible${chosenMatch?.etaMinutes!=null?` · estimated ${chosenMatch.etaMinutes} min travel`:''}`:scheduledLabel??'Not chosen'}/>
        <ReviewRow label="Price" value={chosenMatch?.startingPrice!=null?`From ${IndiaLocale.formatCurrency(chosenMatch.startingPrice)}; final scope and price confirmed before work`:'To be agreed with the professional before work'}/>
      </View>
      <Text style={s.text}>{mode==='ASAP'?'Travel time is an estimate, not a guarantee; service completion is not promised within 30 minutes.':'The requested time is subject to professional acceptance.'} You can still edit the request before sending.</Text>
      {book.error?<Text accessibilityRole="alert" style={styles.error}>{book.error instanceof Error?book.error.message:'We could not send this request right now. Check your connection and try again.'} Your details are saved here; retrying will not create a duplicate request.</Text>:null}
      <Button label={locked?'Retry same request':'Send request'} loading={book.isPending} loadingLabel="Sending request" disabled={book.isPending} onPress={()=>book.mutate()}/>
      {!book.isPending?<Button label="Edit request" variant="secondary" onPress={()=>{book.reset();setReview(false);pending.current=null;key.current=submissionId();}}/>:null}
    </>:<>
    <PlusPerkStrip />
    <Text accessibilityRole="header" style={s.title}>Service address</Text>
    <Text style={s.text}>Use your current location or search a different address for a family member. This will not change your profile address.</Text>
    {!locked ? <LocationPicker onSelect={v=>{reset();setLocation(v);}} onSearching={()=>{reset();setLocation(null);}}/> : null}
    {location?<View style={styles.address}><Icon name="map-marker-outline" color={Colors.teal} size={22}/><Text style={[s.text,{flex:1}]}>{location.address}</Text></View>:null}
    {!locked ? <><Input label="House/flat, street and landmark" value={address} onChangeText={v=>{reset();setAddress(v);}} maxLength={200}/>
    <Input label="What work is needed?" value={description} onChangeText={v=>{reset();setDescription(v);}} multiline maxLength={2000}/>
    <Input label="Person at the address" value={name} onChangeText={v=>{reset();setName(v);}} maxLength={100}/>
    <Input label="Recipient mobile number" value={phone} onChangeText={v=>{reset();setPhone(v);}} keyboardType="phone-pad" maxLength={16}/>
    <View style={{flexDirection:'row',alignItems:'center'}}><Text style={[s.text,{flex:1}]}>I am the recipient, or have their permission to share these details.</Text><Switch accessibilityLabel="Recipient consent" value={consent} onValueChange={setConsent}/></View>
    <Text accessibilityRole="header" style={s.title}>Visit time</Text>
    <View style={styles.options}>
      {([{value:'ASAP',label:'As soon as possible',icon:'clock-outline'},{value:'SCHEDULED',label:'Schedule a visit',icon:'calendar-outline'}] as const).map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityState={{checked:mode===option.value}} onPress={()=>{reset();setMode(option.value);}} style={[styles.option,mode===option.value&&styles.selected]}><Icon name={option.icon} color={Colors.navyDeep} size={22}/><Text style={styles.optionText}>{option.label}</Text></Pressable>)}
    </View>
    {mode==='SCHEDULED'?<>
      <Text style={styles.scheduleLabel}>Quick picks · local time</Text>
      <View style={styles.schedulePicks}>{[{label:'Tomorrow · 9 AM',days:1,hour:9},{label:'Tomorrow · 2 PM',days:1,hour:14},{label:'In 2 days · 9 AM',days:2,hour:9},{label:'In 2 days · 2 PM',days:2,hour:14}].map(option=><Pressable key={option.label} accessibilityRole="button" onPress={()=>{reset();setSchedule(chipDate(option.days,option.hour));}} style={[styles.scheduleChip,schedule?.getTime()===chipDate(option.days,option.hour).getTime()&&styles.scheduleChipSelected]}><Text style={styles.scheduleChipText}>{option.label}</Text></Pressable>)}</View>
      <DateTimeField label="Or choose a date and time" accessibilityLabel="Visit date and time, local time" value={schedule} onChange={picked=>{reset();setSchedule(picked);}} minimumDate={new Date(Date.now()+30*60000)} maximumDate={new Date(Date.now()+30*86400000)} />
      <Text style={s.text}>Visits must be 30 minutes to 30 days from now.</Text>
    </>:null}
    {preferred?<View style={{flexDirection:'row',alignItems:'center'}}><Text style={[s.text,{flex:1}]}>Find someone nearby instead of only {preferred.fullName}</Text><Switch accessibilityLabel="Find nearby alternative professionals" value={automatic} onValueChange={v=>{reset();setAutomatic(v);}}/></View>:null}
    <Button label="Check professionals at this address" disabled={!location || search.isPending} loading={search.isPending} onPress={()=>{if(!location)return;setMatches([]);setChosen(null);search.mutate({version:++matchVersion.current,latitude:location.latitude,longitude:location.longitude,mode,...(!automatic&&preferred?{professionalProfileId:preferred.id}:{})});}}/>
    </>:null}
    {search.error?<Text accessibilityRole="alert" style={styles.error}>{search.error instanceof Error?search.error.message:'Could not check availability. Please try again.'}</Text>:null}
    {search.isSuccess&&!matches.length?<Text style={s.text}>No eligible provider at this address. Try scheduling a visit or choosing another professional. We will not send this request to someone else without your choice.</Text>:null}
    {matches.map(m=><Pressable key={m.id} accessibilityRole="radio" accessibilityState={{checked:chosen===m.id,disabled:locked}} disabled={locked} style={[styles.match,chosen===m.id&&styles.selected]} onPress={()=>{key.current=submissionId();pending.current=null;setChosen(m.id);}}><View style={{flex:1}}><Text style={styles.optionText}>{m.fullName}</Text><Text style={s.text}>{m.distanceKm} km away{m.etaMinutes!=null?` • About ${m.etaMinutes} min`:''}</Text></View><Icon name={chosen===m.id?ICONS.checkCircle:ICONS.circle} size={22} color={Colors.navyDeep}/></Pressable>)}
    <Text style={s.text}>The professional must accept. Final scope and price are approved before work starts.</Text>
    {mode==='SCHEDULED'&&schedule&&!validSchedule?<Text accessibilityRole="alert" style={styles.error}>Choose a valid local time at least 30 minutes from now and within the next 30 days.</Text>:null}
    {book.error?<Text accessibilityRole="alert" style={s.text}>{book.error instanceof Error?book.error.message:'Could not confirm booking'} You can retry this same submission safely.</Text>:null}
    <Button label={locked?'Retry same booking':'Review request'} loading={book.isPending} disabled={!chosen||!consent||name.trim().length<2||!/^\+?[1-9][0-9]{9,14}$/.test(phone.replace(/[\s()-]/g,''))||description.trim().length<10||address.trim().length<5||(mode==='SCHEDULED'&&!validSchedule)} onPress={submit}/>
    </>}
  </View>;
}

function ReviewRow({label,value}:{label:string;value:string}){return <View style={styles.reviewRow}><Text style={styles.reviewLabel}>{label}</Text><Text style={styles.reviewValue}>{value}</Text></View>;}
function chipDate(days:number,hour:number){const date=new Date();date.setDate(date.getDate()+days);date.setHours(hour,0,0,0);return date;}

const styles=StyleSheet.create({
  address:{flexDirection:'row',alignItems:'center',gap:12,padding:16,borderRadius:12,backgroundColor:Colors.tealBg},
  options:{gap:8},
  option:{minHeight:56,padding:16,flexDirection:'row',alignItems:'center',gap:12,borderRadius:12,borderWidth:1,borderColor:Colors.slate200,backgroundColor:Colors.surface},
  selected:{borderColor:ClientColors.accent,backgroundColor:ClientColors.accentSoft},
  optionText:{...Typography.subtitle,color:Colors.navyDeep,flexShrink:1,fontWeight:'600'},
  match:{minHeight:72,padding:16,borderRadius:16,borderWidth:1,borderColor:Colors.slate200,flexDirection:'row',alignItems:'center',gap:12,backgroundColor:Colors.surface},
  error:{...Typography.body,color:Colors.error,padding:12,backgroundColor:Colors.errorBg,borderRadius:12},
  reviewHeader:{gap:8,padding:18,borderRadius:18,backgroundColor:Colors.navyDeep},
  reviewEyebrow:{...Typography.caption,color:ClientColors.white,fontWeight:'700',letterSpacing:1},
  reviewTitle:{...Typography.h2,color:Colors.surface},
  reviewBody:{...Typography.body,color:Colors.slate200},
  reviewCard:{paddingHorizontal:16,borderRadius:16,borderWidth:1,borderColor:Colors.slate200,backgroundColor:Colors.surface},
  reviewRow:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.slate200,gap:4},
  reviewLabel:{...Typography.caption,color:Colors.slate600},
  reviewValue:{...Typography.body,color:Colors.navyDeep,fontWeight:'600'},
  scheduleLabel:{...Typography.subtitle,color:Colors.slate700,fontWeight:'700'},
  schedulePicks:{flexDirection:'row',flexWrap:'wrap',gap:8},
  scheduleChip:{minHeight:40,paddingHorizontal:12,paddingVertical:8,justifyContent:'center',borderRadius:20,borderWidth:1,borderColor:Colors.slate300,backgroundColor:Colors.surface},
  scheduleChipSelected:{borderColor:ClientColors.accent,backgroundColor:ClientColors.accentSoft},
  scheduleChipText:{...Typography.caption,color:Colors.navyDeep,fontWeight:'600'},
});
