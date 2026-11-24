(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const s of n)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&i(a)}).observe(document,{childList:!0,subtree:!0});function e(n){const s={};return n.integrity&&(s.integrity=n.integrity),n.referrerPolicy&&(s.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?s.credentials="include":n.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(n){if(n.ep)return;n.ep=!0;const s=e(n);fetch(n.href,s)}})();const Up="modulepreload",zp=function(r,t){return new URL(r,t).href},Xc={},Op=function(t,e,i){let n=Promise.resolve();if(e&&e.length>0){let a=function(c){return Promise.all(c.map(d=>Promise.resolve(d).then(u=>({status:"fulfilled",value:u}),u=>({status:"rejected",reason:u}))))};const o=document.getElementsByTagName("link"),l=document.querySelector("meta[property=csp-nonce]"),h=l?.nonce||l?.getAttribute("nonce");n=a(e.map(c=>{if(c=zp(c,i),c in Xc)return;Xc[c]=!0;const d=c.endsWith(".css"),u=d?'[rel="stylesheet"]':"";if(!!i)for(let x=o.length-1;x>=0;x--){const m=o[x];if(m.href===c&&(!d||m.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${c}"]${u}`))return;const p=document.createElement("link");if(p.rel=d?"stylesheet":Up,d||(p.as="script"),p.crossOrigin="",p.href=c,h&&p.setAttribute("nonce",h),document.head.appendChild(p),d)return new Promise((x,m)=>{p.addEventListener("load",x),p.addEventListener("error",()=>m(new Error(`Unable to preload CSS for ${c}`)))})}))}function s(a){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=a,window.dispatchEvent(o),!o.defaultPrevented)throw a}return n.then(a=>{for(const o of a||[])o.status==="rejected"&&s(o.reason);return t().catch(s)})};/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const sc="185",sr={ROTATE:0,DOLLY:1,PAN:2},er={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},kp=0,qc=1,Bp=2,xo=1,vf=2,qr=3,Fn=0,Be=1,en=2,sn=0,rr=1,$c=2,Yc=3,Zc=4,Vp=5,ts=100,Gp=101,Hp=102,Wp=103,Xp=104,qp=200,$p=201,Yp=202,Zp=203,oh=204,lh=205,Kp=206,Jp=207,Qp=208,jp=209,tm=210,em=211,im=212,nm=213,sm=214,hh=0,ch=1,uh=2,dr=3,dh=4,fh=5,ph=6,mh=7,rc=0,rm=1,am=2,Ai=0,ac=1,oc=2,lc=3,hc=4,Mf=5,cc=6,Vo=7,bf=300,ss=301,fr=302,Jr=303,Yo=304,Go=306,gh=1e3,nn=1001,xh=1002,Oe=1003,om=1004,pa=1005,qe=1006,Zo=1007,is=1008,ui=1009,Sf=1010,wf=1011,sa=1012,uc=1013,Gi=1014,Ei=1015,on=1016,dc=1017,fc=1018,ra=1020,Ef=35902,Tf=35899,Af=1021,Cf=1022,Ti=1023,ln=1026,ns=1027,pc=1028,mc=1029,rs=1030,gc=1031,xc=1033,yo=33776,_o=33777,vo=33778,Mo=33779,yh=35840,_h=35841,vh=35842,Mh=35843,bh=36196,Sh=37492,wh=37496,Eh=37488,Th=37489,Po=37490,Ah=37491,Ch=37808,Rh=37809,Ph=37810,Ih=37811,Dh=37812,Lh=37813,Nh=37814,Fh=37815,Uh=37816,zh=37817,Oh=37818,kh=37819,Bh=37820,Vh=37821,Gh=36492,Hh=36494,Wh=36495,Xh=36283,qh=36284,Io=36285,$h=36286,lm=3200,Do=0,hm=1,Pn="",oi="srgb",Lo="srgb-linear",No="linear",ie="srgb",fs=7680,Kc=519,cm=512,um=513,dm=514,yc=515,fm=516,pm=517,_c=518,mm=519,Jc=35044,Qc="300 es",ki=2e3,aa=2001;function gm(r){for(let t=r.length-1;t>=0;--t)if(r[t]>=65535)return!0;return!1}function Fo(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}function xm(){const r=Fo("canvas");return r.style.display="block",r}const jc={};function tu(...r){const t="THREE."+r.shift();console.log(t,...r)}function Rf(r){const t=r[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=r[1];e&&e.isStackTrace?r[0]+=" "+e.getLocation():r[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return r}function Nt(...r){r=Rf(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...r)}}function Qt(...r){r=Rf(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...r)}}function ar(...r){const t=r.join(" ");t in jc||(jc[t]=!0,Nt(...r))}function ym(r,t,e){return new Promise(function(i,n){function s(){switch(r.clientWaitSync(t,r.SYNC_FLUSH_COMMANDS_BIT,0)){case r.WAIT_FAILED:n();break;case r.TIMEOUT_EXPIRED:setTimeout(s,e);break;default:i()}}setTimeout(s,e)})}const _m={[hh]:ch,[uh]:ph,[dh]:mh,[dr]:fh,[ch]:hh,[ph]:uh,[mh]:dh,[fh]:dr};let Bn=class{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(e)===-1&&i[t].push(e)}hasEventListener(t,e){const i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(e)!==-1}removeEventListener(t,e){const i=this._listeners;if(i===void 0)return;const n=i[t];if(n!==void 0){const s=n.indexOf(e);s!==-1&&n.splice(s,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const i=e[t.type];if(i!==void 0){t.target=this;const n=i.slice(0);for(let s=0,a=n.length;s<a;s++)n[s].call(this,t);t.target=null}}};const Ge=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let eu=1234567;const Qr=Math.PI/180,oa=180/Math.PI;function yr(){const r=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(Ge[r&255]+Ge[r>>8&255]+Ge[r>>16&255]+Ge[r>>24&255]+"-"+Ge[t&255]+Ge[t>>8&255]+"-"+Ge[t>>16&15|64]+Ge[t>>24&255]+"-"+Ge[e&63|128]+Ge[e>>8&255]+"-"+Ge[e>>16&255]+Ge[e>>24&255]+Ge[i&255]+Ge[i>>8&255]+Ge[i>>16&255]+Ge[i>>24&255]).toLowerCase()}function $t(r,t,e){return Math.max(t,Math.min(e,r))}function vc(r,t){return(r%t+t)%t}function vm(r,t,e,i,n){return i+(r-t)*(n-i)/(e-t)}function Mm(r,t,e){return r!==t?(e-r)/(t-r):0}function jr(r,t,e){return(1-e)*r+e*t}function bm(r,t,e,i){return jr(r,t,1-Math.exp(-e*i))}function Sm(r,t=1){return t-Math.abs(vc(r,t*2)-t)}function wm(r,t,e){return r<=t?0:r>=e?1:(r=(r-t)/(e-t),r*r*(3-2*r))}function Em(r,t,e){return r<=t?0:r>=e?1:(r=(r-t)/(e-t),r*r*r*(r*(r*6-15)+10))}function Tm(r,t){return r+Math.floor(Math.random()*(t-r+1))}function Am(r,t){return r+Math.random()*(t-r)}function Cm(r){return r*(.5-Math.random())}function Rm(r){r!==void 0&&(eu=r);let t=eu+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function Pm(r){return r*Qr}function Im(r){return r*oa}function Dm(r){return(r&r-1)===0&&r!==0}function Lm(r){return Math.pow(2,Math.ceil(Math.log(r)/Math.LN2))}function Nm(r){return Math.pow(2,Math.floor(Math.log(r)/Math.LN2))}function Fm(r,t,e,i,n){const s=Math.cos,a=Math.sin,o=s(e/2),l=a(e/2),h=s((t+i)/2),c=a((t+i)/2),d=s((t-i)/2),u=a((t-i)/2),f=s((i-t)/2),p=a((i-t)/2);switch(n){case"XYX":r.set(o*c,l*d,l*u,o*h);break;case"YZY":r.set(l*u,o*c,l*d,o*h);break;case"ZXZ":r.set(l*d,l*u,o*c,o*h);break;case"XZX":r.set(o*c,l*p,l*f,o*h);break;case"YXY":r.set(l*f,o*c,l*p,o*h);break;case"ZYZ":r.set(l*p,l*f,o*c,o*h);break;default:Nt("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+n)}}function Qs(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function Ye(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}const Yh={DEG2RAD:Qr,RAD2DEG:oa,generateUUID:yr,clamp:$t,euclideanModulo:vc,mapLinear:vm,inverseLerp:Mm,lerp:jr,damp:bm,pingpong:Sm,smoothstep:wm,smootherstep:Em,randInt:Tm,randFloat:Am,randFloatSpread:Cm,seededRandom:Rm,degToRad:Pm,radToDeg:Im,isPowerOfTwo:Dm,ceilPowerOfTwo:Lm,floorPowerOfTwo:Nm,setQuaternionFromProperEuler:Fm,normalize:Ye,denormalize:Qs};let Ut=class Pf{static{Pf.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,i=this.y,n=t.elements;return this.x=n[0]*e+n[3]*i+n[6],this.y=n[1]*e+n[4]*i+n[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=$t(this.x,t.x,e.x),this.y=$t(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=$t(this.x,t,e),this.y=$t(this.y,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar($t(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos($t(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y;return e*e+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const i=Math.cos(e),n=Math.sin(e),s=this.x-t.x,a=this.y-t.y;return this.x=s*i-a*n+t.x,this.y=s*n+a*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Un=class{constructor(t=0,e=0,i=0,n=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=i,this._w=n}static slerpFlat(t,e,i,n,s,a,o){let l=i[n+0],h=i[n+1],c=i[n+2],d=i[n+3],u=s[a+0],f=s[a+1],p=s[a+2],x=s[a+3];if(d!==x||l!==u||h!==f||c!==p){let m=l*u+h*f+c*p+d*x;m<0&&(u=-u,f=-f,p=-p,x=-x,m=-m);let g=1-o;if(m<.9995){const v=Math.acos(m),S=Math.sin(v);g=Math.sin(g*v)/S,o=Math.sin(o*v)/S,l=l*g+u*o,h=h*g+f*o,c=c*g+p*o,d=d*g+x*o}else{l=l*g+u*o,h=h*g+f*o,c=c*g+p*o,d=d*g+x*o;const v=1/Math.sqrt(l*l+h*h+c*c+d*d);l*=v,h*=v,c*=v,d*=v}}t[e]=l,t[e+1]=h,t[e+2]=c,t[e+3]=d}static multiplyQuaternionsFlat(t,e,i,n,s,a){const o=i[n],l=i[n+1],h=i[n+2],c=i[n+3],d=s[a],u=s[a+1],f=s[a+2],p=s[a+3];return t[e]=o*p+c*d+l*f-h*u,t[e+1]=l*p+c*u+h*d-o*f,t[e+2]=h*p+c*f+o*u-l*d,t[e+3]=c*p-o*d-l*u-h*f,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,i,n){return this._x=t,this._y=e,this._z=i,this._w=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const i=t._x,n=t._y,s=t._z,a=t._order,o=Math.cos,l=Math.sin,h=o(i/2),c=o(n/2),d=o(s/2),u=l(i/2),f=l(n/2),p=l(s/2);switch(a){case"XYZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"YXZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"ZXY":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"ZYX":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"YZX":this._x=u*c*d+h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d-u*f*p;break;case"XZY":this._x=u*c*d-h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d+u*f*p;break;default:Nt("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const i=e/2,n=Math.sin(i);return this._x=t.x*n,this._y=t.y*n,this._z=t.z*n,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,i=e[0],n=e[4],s=e[8],a=e[1],o=e[5],l=e[9],h=e[2],c=e[6],d=e[10],u=i+o+d;if(u>0){const f=.5/Math.sqrt(u+1);this._w=.25/f,this._x=(c-l)*f,this._y=(s-h)*f,this._z=(a-n)*f}else if(i>o&&i>d){const f=2*Math.sqrt(1+i-o-d);this._w=(c-l)/f,this._x=.25*f,this._y=(n+a)/f,this._z=(s+h)/f}else if(o>d){const f=2*Math.sqrt(1+o-i-d);this._w=(s-h)/f,this._x=(n+a)/f,this._y=.25*f,this._z=(l+c)/f}else{const f=2*Math.sqrt(1+d-i-o);this._w=(a-n)/f,this._x=(s+h)/f,this._y=(l+c)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let i=t.dot(e)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs($t(this.dot(t),-1,1)))}rotateTowards(t,e){const i=this.angleTo(t);if(i===0)return this;const n=Math.min(1,e/i);return this.slerp(t,n),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const i=t._x,n=t._y,s=t._z,a=t._w,o=e._x,l=e._y,h=e._z,c=e._w;return this._x=i*c+a*o+n*h-s*l,this._y=n*c+a*l+s*o-i*h,this._z=s*c+a*h+i*l-n*o,this._w=a*c-i*o-n*l-s*h,this._onChangeCallback(),this}slerp(t,e){let i=t._x,n=t._y,s=t._z,a=t._w,o=this.dot(t);o<0&&(i=-i,n=-n,s=-s,a=-a,o=-o);let l=1-e;if(o<.9995){const h=Math.acos(o),c=Math.sin(h);l=Math.sin(l*h)/c,e=Math.sin(e*h)/c,this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,i){return this.copy(t).slerp(e,i)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),i=Math.random(),n=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(n*Math.sin(t),n*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},B=class If{static{If.prototype.isVector3=!0}constructor(t=0,e=0,i=0){this.x=t,this.y=e,this.z=i}set(t,e,i){return i===void 0&&(i=this.z),this.x=t,this.y=e,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(iu.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(iu.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[3]*i+s[6]*n,this.y=s[1]*e+s[4]*i+s[7]*n,this.z=s[2]*e+s[5]*i+s[8]*n,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=t.elements,a=1/(s[3]*e+s[7]*i+s[11]*n+s[15]);return this.x=(s[0]*e+s[4]*i+s[8]*n+s[12])*a,this.y=(s[1]*e+s[5]*i+s[9]*n+s[13])*a,this.z=(s[2]*e+s[6]*i+s[10]*n+s[14])*a,this}applyQuaternion(t){const e=this.x,i=this.y,n=this.z,s=t.x,a=t.y,o=t.z,l=t.w,h=2*(a*n-o*i),c=2*(o*e-s*n),d=2*(s*i-a*e);return this.x=e+l*h+a*d-o*c,this.y=i+l*c+o*h-s*d,this.z=n+l*d+s*c-a*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[4]*i+s[8]*n,this.y=s[1]*e+s[5]*i+s[9]*n,this.z=s[2]*e+s[6]*i+s[10]*n,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=$t(this.x,t.x,e.x),this.y=$t(this.y,t.y,e.y),this.z=$t(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=$t(this.x,t,e),this.y=$t(this.y,t,e),this.z=$t(this.z,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar($t(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const i=t.x,n=t.y,s=t.z,a=e.x,o=e.y,l=e.z;return this.x=n*l-s*o,this.y=s*a-i*l,this.z=i*o-n*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const i=t.dot(this)/e;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return Ko.copy(this).projectOnVector(t),this.sub(Ko)}reflect(t){return this.sub(Ko.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos($t(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y,n=this.z-t.z;return e*e+i*i+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,i){const n=Math.sin(e)*t;return this.x=n*Math.sin(i),this.y=Math.cos(e)*t,this.z=n*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,i){return this.x=t*Math.sin(e),this.y=i,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),n=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=i,this.z=n,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,i=Math.sqrt(1-e*e);return this.x=i*Math.cos(t),this.y=e,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};const Ko=new B,iu=new Un;let Gt=class Df{static{Df.prototype.isMatrix3=!0}constructor(t,e,i,n,s,a,o,l,h){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h)}set(t,e,i,n,s,a,o,l,h){const c=this.elements;return c[0]=t,c[1]=n,c[2]=o,c[3]=e,c[4]=s,c[5]=l,c[6]=i,c[7]=a,c[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],this}extractBasis(t,e,i){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[3],l=i[6],h=i[1],c=i[4],d=i[7],u=i[2],f=i[5],p=i[8],x=n[0],m=n[3],g=n[6],v=n[1],S=n[4],_=n[7],E=n[2],b=n[5],A=n[8];return s[0]=a*x+o*v+l*E,s[3]=a*m+o*S+l*b,s[6]=a*g+o*_+l*A,s[1]=h*x+c*v+d*E,s[4]=h*m+c*S+d*b,s[7]=h*g+c*_+d*A,s[2]=u*x+f*v+p*E,s[5]=u*m+f*S+p*b,s[8]=u*g+f*_+p*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8];return e*a*c-e*o*h-i*s*c+i*o*l+n*s*h-n*a*l}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=c*a-o*h,u=o*l-c*s,f=h*s-a*l,p=e*d+i*u+n*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/p;return t[0]=d*x,t[1]=(n*h-c*i)*x,t[2]=(o*i-n*a)*x,t[3]=u*x,t[4]=(c*e-n*l)*x,t[5]=(n*s-o*e)*x,t[6]=f*x,t[7]=(i*l-h*e)*x,t[8]=(a*e-i*s)*x,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,i,n,s,a,o){const l=Math.cos(s),h=Math.sin(s);return this.set(i*l,i*h,-i*(l*a+h*o)+a+t,-n*h,n*l,-n*(-h*a+l*o)+o+e,0,0,1),this}scale(t,e){return ar("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(Jo.makeScale(t,e)),this}rotate(t){return ar("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(Jo.makeRotation(-t)),this}translate(t,e){return ar("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(Jo.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,i,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<9;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<9;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}};const Jo=new Gt,nu=new Gt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),su=new Gt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Um(){const r={enabled:!0,workingColorSpace:Lo,spaces:{},convert:function(n,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===ie&&(n.r=rn(n.r),n.g=rn(n.g),n.b=rn(n.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(n.applyMatrix3(this.spaces[s].toXYZ),n.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===ie&&(n.r=or(n.r),n.g=or(n.g),n.b=or(n.b))),n},workingToColorSpace:function(n,s){return this.convert(n,this.workingColorSpace,s)},colorSpaceToWorking:function(n,s){return this.convert(n,s,this.workingColorSpace)},getPrimaries:function(n){return this.spaces[n].primaries},getTransfer:function(n){return n===Pn?No:this.spaces[n].transfer},getToneMappingMode:function(n){return this.spaces[n].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(n,s=this.workingColorSpace){return n.fromArray(this.spaces[s].luminanceCoefficients)},define:function(n){Object.assign(this.spaces,n)},_getMatrix:function(n,s,a){return n.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(n){return this.spaces[n].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(n=this.workingColorSpace){return this.spaces[n].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(n,s){return ar("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),r.workingToColorSpace(n,s)},toWorkingColorSpace:function(n,s){return ar("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),r.colorSpaceToWorking(n,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],i=[.3127,.329];return r.define({[Lo]:{primaries:t,whitePoint:i,transfer:No,toXYZ:nu,fromXYZ:su,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:oi},outputColorSpaceConfig:{drawingBufferColorSpace:oi}},[oi]:{primaries:t,whitePoint:i,transfer:ie,toXYZ:nu,fromXYZ:su,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:oi}}}),r}const Zt=Um();function rn(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function or(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}let ps,zm=class{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{ps===void 0&&(ps=Fo("canvas")),ps.width=t.width,ps.height=t.height;const n=ps.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),i=ps}return i.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Fo("canvas");e.width=t.width,e.height=t.height;const i=e.getContext("2d");i.drawImage(t,0,0,t.width,t.height);const n=i.getImageData(0,0,t.width,t.height),s=n.data;for(let a=0;a<s.length;a++)s[a]=rn(s[a]/255)*255;return i.putImageData(n,0,0),e}else if(t.data){const e=t.data.slice(0);for(let i=0;i<e.length;i++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[i]=Math.floor(rn(e[i]/255)*255):e[i]=rn(e[i]);return{data:e,width:t.width,height:t.height}}else return Nt("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},Om=0,Mc=class{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Om++}),this.uuid=yr(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const i={uuid:this.uuid,url:""},n=this.data;if(n!==null){let s;if(Array.isArray(n)){s=[];for(let a=0,o=n.length;a<o;a++)n[a].isDataTexture?s.push(Qo(n[a].image)):s.push(Qo(n[a]))}else s=Qo(n);i.url=s}return e||(t.images[this.uuid]=i),i}};function Qo(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?zm.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(Nt("Texture: Unable to serialize Texture."),{})}let km=0;const jo=new B;let Ri=class bo extends Bn{constructor(t=bo.DEFAULT_IMAGE,e=bo.DEFAULT_MAPPING,i=nn,n=nn,s=qe,a=is,o=Ti,l=ui,h=bo.DEFAULT_ANISOTROPY,c=Pn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:km++}),this.uuid=yr(),this.name="",this.source=new Mc(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=i,this.wrapT=n,this.magFilter=s,this.minFilter=a,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Ut(0,0),this.repeat=new Ut(1,1),this.center=new Ut(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Gt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=c,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(jo).x}get height(){return this.source.getSize(jo).y}get depth(){return this.source.getSize(jo).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const i=t[e];if(i===void 0){Nt(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Nt(`Texture.setValues(): property '${e}' does not exist.`);continue}n&&i&&n.isVector2&&i.isVector2||n&&i&&n.isVector3&&i.isVector3||n&&i&&n.isMatrix3&&i.isMatrix3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),e||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==bf)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case gh:t.x=t.x-Math.floor(t.x);break;case nn:t.x=t.x<0?0:1;break;case xh:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case gh:t.y=t.y-Math.floor(t.y);break;case nn:t.y=t.y<0?0:1;break;case xh:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};Ri.DEFAULT_IMAGE=null;Ri.DEFAULT_MAPPING=bf;Ri.DEFAULT_ANISOTROPY=1;let Te=class Lf{static{Lf.prototype.isVector4=!0}constructor(t=0,e=0,i=0,n=1){this.x=t,this.y=e,this.z=i,this.w=n}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,i,n){return this.x=t,this.y=e,this.z=i,this.w=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=this.w,a=t.elements;return this.x=a[0]*e+a[4]*i+a[8]*n+a[12]*s,this.y=a[1]*e+a[5]*i+a[9]*n+a[13]*s,this.z=a[2]*e+a[6]*i+a[10]*n+a[14]*s,this.w=a[3]*e+a[7]*i+a[11]*n+a[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,i,n,s;const l=t.elements,h=l[0],c=l[4],d=l[8],u=l[1],f=l[5],p=l[9],x=l[2],m=l[6],g=l[10];if(Math.abs(c-u)<.01&&Math.abs(d-x)<.01&&Math.abs(p-m)<.01){if(Math.abs(c+u)<.1&&Math.abs(d+x)<.1&&Math.abs(p+m)<.1&&Math.abs(h+f+g-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const S=(h+1)/2,_=(f+1)/2,E=(g+1)/2,b=(c+u)/4,A=(d+x)/4,y=(p+m)/4;return S>_&&S>E?S<.01?(i=0,n=.707106781,s=.707106781):(i=Math.sqrt(S),n=b/i,s=A/i):_>E?_<.01?(i=.707106781,n=0,s=.707106781):(n=Math.sqrt(_),i=b/n,s=y/n):E<.01?(i=.707106781,n=.707106781,s=0):(s=Math.sqrt(E),i=A/s,n=y/s),this.set(i,n,s,e),this}let v=Math.sqrt((m-p)*(m-p)+(d-x)*(d-x)+(u-c)*(u-c));return Math.abs(v)<.001&&(v=1),this.x=(m-p)/v,this.y=(d-x)/v,this.z=(u-c)/v,this.w=Math.acos((h+f+g-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=$t(this.x,t.x,e.x),this.y=$t(this.y,t.y,e.y),this.z=$t(this.z,t.z,e.z),this.w=$t(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=$t(this.x,t,e),this.y=$t(this.y,t,e),this.z=$t(this.z,t,e),this.w=$t(this.w,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar($t(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this.w=t.w+(e.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Bm=class extends Bn{constructor(t=1,e=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:qe,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},i),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=i.depth,this.scissor=new Te(0,0,t,e),this.scissorTest=!1,this.viewport=new Te(0,0,t,e),this.textures=[];const n={width:t,height:e,depth:i.depth},s=new Ri(n),a=i.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview,this.useArrayDepthTexture=i.useArrayDepthTexture}_setTextureOptions(t={}){const e={minFilter:qe,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,i=1){if(this.width!==t||this.height!==e||this.depth!==i){this.width=t,this.height=e,this.depth=i;for(let n=0,s=this.textures.length;n<s;n++)this.textures[n].image.width=t,this.textures[n].image.height=e,this.textures[n].image.depth=i,this.textures[n].isData3DTexture!==!0&&(this.textures[n].isArrayTexture=this.textures[n].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,i=t.textures.length;e<i;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const n=Object.assign({},t.textures[e].image);this.textures[e].source=new Mc(n)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},Bi=class extends Bm{constructor(t=1,e=1,i={}){super(t,e,i),this.isWebGLRenderTarget=!0}};class Nf extends Ri{constructor(t=null,e=1,i=1,n=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:i,depth:n},this.magFilter=Oe,this.minFilter=Oe,this.wrapR=nn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class Vm extends Ri{constructor(t=null,e=1,i=1,n=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:i,depth:n},this.magFilter=Oe,this.minFilter=Oe,this.wrapR=nn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}let pe=class Zh{static{Zh.prototype.isMatrix4=!0}constructor(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,m)}set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,m){const g=this.elements;return g[0]=t,g[4]=e,g[8]=i,g[12]=n,g[1]=s,g[5]=a,g[9]=o,g[13]=l,g[2]=h,g[6]=c,g[10]=d,g[14]=u,g[3]=f,g[7]=p,g[11]=x,g[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Zh().fromArray(this.elements)}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],e[9]=i[9],e[10]=i[10],e[11]=i[11],e[12]=i[12],e[13]=i[13],e[14]=i[14],e[15]=i[15],this}copyPosition(t){const e=this.elements,i=t.elements;return e[12]=i[12],e[13]=i[13],e[14]=i[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,i){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,e,i){return this.set(t.x,e.x,i.x,0,t.y,e.y,i.y,0,t.z,e.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,i=t.elements,n=1/ms.setFromMatrixColumn(t,0).length(),s=1/ms.setFromMatrixColumn(t,1).length(),a=1/ms.setFromMatrixColumn(t,2).length();return e[0]=i[0]*n,e[1]=i[1]*n,e[2]=i[2]*n,e[3]=0,e[4]=i[4]*s,e[5]=i[5]*s,e[6]=i[6]*s,e[7]=0,e[8]=i[8]*a,e[9]=i[9]*a,e[10]=i[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,i=t.x,n=t.y,s=t.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(n),h=Math.sin(n),c=Math.cos(s),d=Math.sin(s);if(t.order==="XYZ"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=-l*d,e[8]=h,e[1]=f+p*h,e[5]=u-x*h,e[9]=-o*l,e[2]=x-u*h,e[6]=p+f*h,e[10]=a*l}else if(t.order==="YXZ"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u+x*o,e[4]=p*o-f,e[8]=a*h,e[1]=a*d,e[5]=a*c,e[9]=-o,e[2]=f*o-p,e[6]=x+u*o,e[10]=a*l}else if(t.order==="ZXY"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u-x*o,e[4]=-a*d,e[8]=p+f*o,e[1]=f+p*o,e[5]=a*c,e[9]=x-u*o,e[2]=-a*h,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=p*h-f,e[8]=u*h+x,e[1]=l*d,e[5]=x*h+u,e[9]=f*h-p,e[2]=-h,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=x-u*d,e[8]=p*d+f,e[1]=d,e[5]=a*c,e[9]=-o*c,e[2]=-h*c,e[6]=f*d+p,e[10]=u-x*d}else if(t.order==="XZY"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=-d,e[8]=h*c,e[1]=u*d+x,e[5]=a*c,e[9]=f*d-p,e[2]=p*d-f,e[6]=o*c,e[10]=x*d+u}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Gm,t,Hm)}lookAt(t,e,i){const n=this.elements;return ni.subVectors(t,e),ni.lengthSq()===0&&(ni.z=1),ni.normalize(),pn.crossVectors(i,ni),pn.lengthSq()===0&&(Math.abs(i.z)===1?ni.x+=1e-4:ni.z+=1e-4,ni.normalize(),pn.crossVectors(i,ni)),pn.normalize(),ma.crossVectors(ni,pn),n[0]=pn.x,n[4]=ma.x,n[8]=ni.x,n[1]=pn.y,n[5]=ma.y,n[9]=ni.y,n[2]=pn.z,n[6]=ma.z,n[10]=ni.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[4],l=i[8],h=i[12],c=i[1],d=i[5],u=i[9],f=i[13],p=i[2],x=i[6],m=i[10],g=i[14],v=i[3],S=i[7],_=i[11],E=i[15],b=n[0],A=n[4],y=n[8],w=n[12],C=n[1],R=n[5],I=n[9],z=n[13],G=n[2],L=n[6],N=n[10],D=n[14],$=n[3],Q=n[7],st=n[11],rt=n[15];return s[0]=a*b+o*C+l*G+h*$,s[4]=a*A+o*R+l*L+h*Q,s[8]=a*y+o*I+l*N+h*st,s[12]=a*w+o*z+l*D+h*rt,s[1]=c*b+d*C+u*G+f*$,s[5]=c*A+d*R+u*L+f*Q,s[9]=c*y+d*I+u*N+f*st,s[13]=c*w+d*z+u*D+f*rt,s[2]=p*b+x*C+m*G+g*$,s[6]=p*A+x*R+m*L+g*Q,s[10]=p*y+x*I+m*N+g*st,s[14]=p*w+x*z+m*D+g*rt,s[3]=v*b+S*C+_*G+E*$,s[7]=v*A+S*R+_*L+E*Q,s[11]=v*y+S*I+_*N+E*st,s[15]=v*w+S*z+_*D+E*rt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[12],a=t[1],o=t[5],l=t[9],h=t[13],c=t[2],d=t[6],u=t[10],f=t[14],p=t[3],x=t[7],m=t[11],g=t[15],v=l*f-h*u,S=o*f-h*d,_=o*u-l*d,E=a*f-h*c,b=a*u-l*c,A=a*d-o*c;return e*(x*v-m*S+g*_)-i*(p*v-m*E+g*b)+n*(p*S-x*E+g*A)-s*(p*_-x*b+m*A)}determinantAffine(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[1],a=t[5],o=t[9],l=t[2],h=t[6],c=t[10];return e*(a*c-o*h)-i*(s*c-o*l)+n*(s*h-a*l)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,i){const n=this.elements;return t.isVector3?(n[12]=t.x,n[13]=t.y,n[14]=t.z):(n[12]=t,n[13]=e,n[14]=i),this}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=t[9],u=t[10],f=t[11],p=t[12],x=t[13],m=t[14],g=t[15],v=e*o-i*a,S=e*l-n*a,_=e*h-s*a,E=i*l-n*o,b=i*h-s*o,A=n*h-s*l,y=c*x-d*p,w=c*m-u*p,C=c*g-f*p,R=d*m-u*x,I=d*g-f*x,z=u*g-f*m,G=v*z-S*I+_*R+E*C-b*w+A*y;if(G===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const L=1/G;return t[0]=(o*z-l*I+h*R)*L,t[1]=(n*I-i*z-s*R)*L,t[2]=(x*A-m*b+g*E)*L,t[3]=(u*b-d*A-f*E)*L,t[4]=(l*C-a*z-h*w)*L,t[5]=(e*z-n*C+s*w)*L,t[6]=(m*_-p*A-g*S)*L,t[7]=(c*A-u*_+f*S)*L,t[8]=(a*I-o*C+h*y)*L,t[9]=(i*C-e*I-s*y)*L,t[10]=(p*b-x*_+g*v)*L,t[11]=(d*_-c*b-f*v)*L,t[12]=(o*w-a*R-l*y)*L,t[13]=(e*R-i*w+n*y)*L,t[14]=(x*S-p*E-m*v)*L,t[15]=(c*E-d*S+u*v)*L,this}scale(t){const e=this.elements,i=t.x,n=t.y,s=t.z;return e[0]*=i,e[4]*=n,e[8]*=s,e[1]*=i,e[5]*=n,e[9]*=s,e[2]*=i,e[6]*=n,e[10]*=s,e[3]*=i,e[7]*=n,e[11]*=s,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],n=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,i,n))}makeTranslation(t,e,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,i,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,e,-i,0,0,i,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,0,i,0,0,1,0,0,-i,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,0,i,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const i=Math.cos(e),n=Math.sin(e),s=1-i,a=t.x,o=t.y,l=t.z,h=s*a,c=s*o;return this.set(h*a+i,h*o-n*l,h*l+n*o,0,h*o+n*l,c*o+i,c*l-n*a,0,h*l-n*o,c*l+n*a,s*l*l+i,0,0,0,0,1),this}makeScale(t,e,i){return this.set(t,0,0,0,0,e,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,e,i,n,s,a){return this.set(1,i,s,0,t,1,a,0,e,n,1,0,0,0,0,1),this}compose(t,e,i){const n=this.elements,s=e._x,a=e._y,o=e._z,l=e._w,h=s+s,c=a+a,d=o+o,u=s*h,f=s*c,p=s*d,x=a*c,m=a*d,g=o*d,v=l*h,S=l*c,_=l*d,E=i.x,b=i.y,A=i.z;return n[0]=(1-(x+g))*E,n[1]=(f+_)*E,n[2]=(p-S)*E,n[3]=0,n[4]=(f-_)*b,n[5]=(1-(u+g))*b,n[6]=(m+v)*b,n[7]=0,n[8]=(p+S)*A,n[9]=(m-v)*A,n[10]=(1-(u+x))*A,n[11]=0,n[12]=t.x,n[13]=t.y,n[14]=t.z,n[15]=1,this}decompose(t,e,i){const n=this.elements;t.x=n[12],t.y=n[13],t.z=n[14];const s=this.determinantAffine();if(s===0)return i.set(1,1,1),e.identity(),this;let a=ms.set(n[0],n[1],n[2]).length();const o=ms.set(n[4],n[5],n[6]).length(),l=ms.set(n[8],n[9],n[10]).length();s<0&&(a=-a),yi.copy(this);const h=1/a,c=1/o,d=1/l;return yi.elements[0]*=h,yi.elements[1]*=h,yi.elements[2]*=h,yi.elements[4]*=c,yi.elements[5]*=c,yi.elements[6]*=c,yi.elements[8]*=d,yi.elements[9]*=d,yi.elements[10]*=d,e.setFromRotationMatrix(yi),i.x=a,i.y=o,i.z=l,this}makePerspective(t,e,i,n,s,a,o=ki,l=!1){const h=this.elements,c=2*s/(e-t),d=2*s/(i-n),u=(e+t)/(e-t),f=(i+n)/(i-n);let p,x;if(l)p=s/(a-s),x=a*s/(a-s);else if(o===ki)p=-(a+s)/(a-s),x=-2*a*s/(a-s);else if(o===aa)p=-a/(a-s),x=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=u,h[12]=0,h[1]=0,h[5]=d,h[9]=f,h[13]=0,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,e,i,n,s,a,o=ki,l=!1){const h=this.elements,c=2/(e-t),d=2/(i-n),u=-(e+t)/(e-t),f=-(i+n)/(i-n);let p,x;if(l)p=1/(a-s),x=a/(a-s);else if(o===ki)p=-2/(a-s),x=-(a+s)/(a-s);else if(o===aa)p=-1/(a-s),x=-s/(a-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=0,h[12]=u,h[1]=0,h[5]=d,h[9]=0,h[13]=f,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<16;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<16;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t[e+9]=i[9],t[e+10]=i[10],t[e+11]=i[11],t[e+12]=i[12],t[e+13]=i[13],t[e+14]=i[14],t[e+15]=i[15],t}};const ms=new B,yi=new pe,Gm=new B(0,0,0),Hm=new B(1,1,1),pn=new B,ma=new B,ni=new B,ru=new pe,au=new Un;let zn=class Ff{constructor(t=0,e=0,i=0,n=Ff.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=i,this._order=n}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,i,n=this._order){return this._x=t,this._y=e,this._z=i,this._order=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,i=!0){const n=t.elements,s=n[0],a=n[4],o=n[8],l=n[1],h=n[5],c=n[9],d=n[2],u=n[6],f=n[10];switch(e){case"XYZ":this._y=Math.asin($t(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-c,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(u,h),this._z=0);break;case"YXZ":this._x=Math.asin(-$t(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin($t(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-a,h)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-$t(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(u,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,h));break;case"YZX":this._z=Math.asin($t(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-c,h),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-$t(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(u,h),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-c,f),this._y=0);break;default:Nt("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,i){return ru.makeRotationFromQuaternion(t),this.setFromRotationMatrix(ru,e,i)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return au.setFromEuler(this),this.setFromQuaternion(au,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};zn.DEFAULT_ORDER="XYZ";let bc=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},Wm=0;const ou=new B,gs=new Un,Wi=new pe,ga=new B,wr=new B,Xm=new B,qm=new Un,lu=new B(1,0,0),hu=new B(0,1,0),cu=new B(0,0,1),uu={type:"added"},$m={type:"removed"},xs={type:"childadded",child:null},tl={type:"childremoved",child:null};let Pi=class So extends Bn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Wm++}),this.uuid=yr(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=So.DEFAULT_UP.clone();const t=new B,e=new zn,i=new Un,n=new B(1,1,1);function s(){i.setFromEuler(e,!1)}function a(){e.setFromQuaternion(i,void 0,!1)}e._onChange(s),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:n},modelViewMatrix:{value:new pe},normalMatrix:{value:new Gt}}),this.matrix=new pe,this.matrixWorld=new pe,this.matrixAutoUpdate=So.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=So.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new bc,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return gs.setFromAxisAngle(t,e),this.quaternion.multiply(gs),this}rotateOnWorldAxis(t,e){return gs.setFromAxisAngle(t,e),this.quaternion.premultiply(gs),this}rotateX(t){return this.rotateOnAxis(lu,t)}rotateY(t){return this.rotateOnAxis(hu,t)}rotateZ(t){return this.rotateOnAxis(cu,t)}translateOnAxis(t,e){return ou.copy(t).applyQuaternion(this.quaternion),this.position.add(ou.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(lu,t)}translateY(t){return this.translateOnAxis(hu,t)}translateZ(t){return this.translateOnAxis(cu,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Wi.copy(this.matrixWorld).invert())}lookAt(t,e,i){t.isVector3?ga.copy(t):ga.set(t,e,i);const n=this.parent;this.updateWorldMatrix(!0,!1),wr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Wi.lookAt(wr,ga,this.up):Wi.lookAt(ga,wr,this.up),this.quaternion.setFromRotationMatrix(Wi),n&&(Wi.extractRotation(n.matrixWorld),gs.setFromRotationMatrix(Wi),this.quaternion.premultiply(gs.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(Qt("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(uu),xs.child=t,this.dispatchEvent(xs),xs.child=null):Qt("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent($m),tl.child=t,this.dispatchEvent(tl),tl.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Wi.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Wi.multiply(t.parent.matrixWorld)),t.applyMatrix4(Wi),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(uu),xs.child=t,this.dispatchEvent(xs),xs.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let i=0,n=this.children.length;i<n;i++){const a=this.children[i].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,i=[]){this[t]===e&&i.push(this);const n=this.children;for(let s=0,a=n.length;s<a;s++)n[s].getObjectsByProperty(t,e,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(wr,t,Xm),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(wr,qm,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,i=t.y,n=t.z,s=this.matrix.elements;s[12]+=e-s[0]*e-s[4]*i-s[8]*n,s[13]+=i-s[1]*e-s[5]*i-s[9]*n,s[14]+=n-s[2]*e-s[6]*i-s[10]*n}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].updateMatrixWorld(t)}updateWorldMatrix(t,e,i=!1){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),e===!0){const s=this.children;for(let a=0,o=s.length;a<o;a++)s[a].updateWorldMatrix(!1,!0,i)}}toJSON(t){const e=t===void 0||typeof t=="string",i={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const n={};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.castShadow===!0&&(n.castShadow=!0),this.receiveShadow===!0&&(n.receiveShadow=!0),this.visible===!1&&(n.visible=!1),this.frustumCulled===!1&&(n.frustumCulled=!1),this.renderOrder!==0&&(n.renderOrder=this.renderOrder),this.static!==!1&&(n.static=this.static),Object.keys(this.userData).length>0&&(n.userData=this.userData),n.layers=this.layers.mask,n.matrix=this.matrix.toArray(),n.up=this.up.toArray(),this.pivot!==null&&(n.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(n.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(n.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(n.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(n.type="InstancedMesh",n.count=this.count,n.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(n.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(n.type="BatchedMesh",n.perObjectFrustumCulled=this.perObjectFrustumCulled,n.sortObjects=this.sortObjects,n.drawRanges=this._drawRanges,n.reservedRanges=this._reservedRanges,n.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),n.instanceInfo=this._instanceInfo.map(o=>({...o})),n.availableInstanceIds=this._availableInstanceIds.slice(),n.availableGeometryIds=this._availableGeometryIds.slice(),n.nextIndexStart=this._nextIndexStart,n.nextVertexStart=this._nextVertexStart,n.geometryCount=this._geometryCount,n.maxInstanceCount=this._maxInstanceCount,n.maxVertexCount=this._maxVertexCount,n.maxIndexCount=this._maxIndexCount,n.geometryInitialized=this._geometryInitialized,n.matricesTexture=this._matricesTexture.toJSON(t),n.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(n.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(n.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(n.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?n.background=this.background.toJSON():this.background.isTexture&&(n.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(n.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){n.geometry=s(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let h=0,c=l.length;h<c;h++){const d=l[h];s(t.shapes,d)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(n.bindMode=this.bindMode,n.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),n.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(s(t.materials,this.material[l]));n.material=o}else n.material=s(t.materials,this.material);if(this.children.length>0){n.children=[];for(let o=0;o<this.children.length;o++)n.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){n.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];n.animations.push(s(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),h=a(t.textures),c=a(t.images),d=a(t.shapes),u=a(t.skeletons),f=a(t.animations),p=a(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),c.length>0&&(i.images=c),d.length>0&&(i.shapes=d),u.length>0&&(i.skeletons=u),f.length>0&&(i.animations=f),p.length>0&&(i.nodes=p)}return i.object=n,i;function a(o){const l=[];for(const h in o){const c=o[h];delete c.metadata,l.push(c)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let i=0;i<t.children.length;i++){const n=t.children[i];this.add(n.clone())}return this}};Pi.DEFAULT_UP=new B(0,1,0);Pi.DEFAULT_MATRIX_AUTO_UPDATE=!0;Pi.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;let ir=class extends Pi{constructor(){super(),this.isGroup=!0,this.type="Group"}};const Ym={type:"move"};class el{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new ir,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new ir,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new B,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new B),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new ir,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new B,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new B,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const i of t.hand.values())this._getHandJoint(e,i)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,i){let n=null,s=null,a=null;const o=this._targetRay,l=this._grip,h=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(h&&t.hand){a=!0;for(const x of t.hand.values()){const m=e.getJointPose(x,i),g=this._getHandJoint(h,x);m!==null&&(g.matrix.fromArray(m.transform.matrix),g.matrix.decompose(g.position,g.rotation,g.scale),g.matrixWorldNeedsUpdate=!0,g.jointRadius=m.radius),g.visible=m!==null}const c=h.joints["index-finger-tip"],d=h.joints["thumb-tip"],u=c.position.distanceTo(d.position),f=.02,p=.005;h.inputState.pinching&&u>f+p?(h.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!h.inputState.pinching&&u<=f-p&&(h.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(s=e.getPose(t.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:t,target:this})));o!==null&&(n=e.getPose(t.targetRaySpace,i),n===null&&s!==null&&(n=s),n!==null&&(o.matrix.fromArray(n.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,n.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(n.linearVelocity)):o.hasLinearVelocity=!1,n.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(n.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(Ym)))}return o!==null&&(o.visible=n!==null),l!==null&&(l.visible=s!==null),h!==null&&(h.visible=a!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const i=new ir;i.matrixAutoUpdate=!1,i.visible=!1,t.joints[e.jointName]=i,t.add(i)}return t.joints[e.jointName]}}const Uf={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},mn={h:0,s:0,l:0},xa={h:0,s:0,l:0};function il(r,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?r+(t-r)*6*e:e<1/2?t:e<2/3?r+(t-r)*6*(2/3-e):r}let zt=class{constructor(t,e,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,i)}set(t,e,i){if(e===void 0&&i===void 0){const n=t;n&&n.isColor?this.copy(n):typeof n=="number"?this.setHex(n):typeof n=="string"&&this.setStyle(n)}else this.setRGB(t,e,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=oi){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,Zt.colorSpaceToWorking(this,e),this}setRGB(t,e,i,n=Zt.workingColorSpace){return this.r=t,this.g=e,this.b=i,Zt.colorSpaceToWorking(this,n),this}setHSL(t,e,i,n=Zt.workingColorSpace){if(t=vc(t,1),e=$t(e,0,1),i=$t(i,0,1),e===0)this.r=this.g=this.b=i;else{const s=i<=.5?i*(1+e):i+e-i*e,a=2*i-s;this.r=il(a,s,t+1/3),this.g=il(a,s,t),this.b=il(a,s,t-1/3)}return Zt.colorSpaceToWorking(this,n),this}setStyle(t,e=oi){function i(s){s!==void 0&&parseFloat(s)<1&&Nt("Color: Alpha component of "+t+" will be ignored.")}let n;if(n=/^(\w+)\(([^\)]*)\)/.exec(t)){let s;const a=n[1],o=n[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:Nt("Color: Unknown color model "+t)}}else if(n=/^\#([A-Fa-f\d]+)$/.exec(t)){const s=n[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(s,16),e);Nt("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=oi){const i=Uf[t.toLowerCase()];return i!==void 0?this.setHex(i,e):Nt("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=rn(t.r),this.g=rn(t.g),this.b=rn(t.b),this}copyLinearToSRGB(t){return this.r=or(t.r),this.g=or(t.g),this.b=or(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=oi){return Zt.workingToColorSpace(He.copy(this),t),Math.round($t(He.r*255,0,255))*65536+Math.round($t(He.g*255,0,255))*256+Math.round($t(He.b*255,0,255))}getHexString(t=oi){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=Zt.workingColorSpace){Zt.workingToColorSpace(He.copy(this),e);const i=He.r,n=He.g,s=He.b,a=Math.max(i,n,s),o=Math.min(i,n,s);let l,h;const c=(o+a)/2;if(o===a)l=0,h=0;else{const d=a-o;switch(h=c<=.5?d/(a+o):d/(2-a-o),a){case i:l=(n-s)/d+(n<s?6:0);break;case n:l=(s-i)/d+2;break;case s:l=(i-n)/d+4;break}l/=6}return t.h=l,t.s=h,t.l=c,t}getRGB(t,e=Zt.workingColorSpace){return Zt.workingToColorSpace(He.copy(this),e),t.r=He.r,t.g=He.g,t.b=He.b,t}getStyle(t=oi){Zt.workingToColorSpace(He.copy(this),t);const e=He.r,i=He.g,n=He.b;return t!==oi?`color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${n.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(i*255)},${Math.round(n*255)})`}offsetHSL(t,e,i){return this.getHSL(mn),this.setHSL(mn.h+t,mn.s+e,mn.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,i){return this.r=t.r+(e.r-t.r)*i,this.g=t.g+(e.g-t.g)*i,this.b=t.b+(e.b-t.b)*i,this}lerpHSL(t,e){this.getHSL(mn),t.getHSL(xa);const i=jr(mn.h,xa.h,e),n=jr(mn.s,xa.s,e),s=jr(mn.l,xa.l,e);return this.setHSL(i,n,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,i=this.g,n=this.b,s=t.elements;return this.r=s[0]*e+s[3]*i+s[6]*n,this.g=s[1]*e+s[4]*i+s[7]*n,this.b=s[2]*e+s[5]*i+s[8]*n,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}};const He=new zt;zt.NAMES=Uf;class Sc{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new zt(t),this.density=e}clone(){return new Sc(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class wc{constructor(t,e=1,i=1e3){this.isFog=!0,this.name="",this.color=new zt(t),this.near=e,this.far=i}clone(){return new wc(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}let wo=class extends Pi{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new zn,this.environmentIntensity=1,this.environmentRotation=new zn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}};const _i=new B,Xi=new B,nl=new B,qi=new B,ys=new B,_s=new B,du=new B,sl=new B,rl=new B,al=new B,ol=new Te,ll=new Te,hl=new Te;let Er=class js{constructor(t=new B,e=new B,i=new B){this.a=t,this.b=e,this.c=i}static getNormal(t,e,i,n){n.subVectors(i,e),_i.subVectors(t,e),n.cross(_i);const s=n.lengthSq();return s>0?n.multiplyScalar(1/Math.sqrt(s)):n.set(0,0,0)}static getBarycoord(t,e,i,n,s){_i.subVectors(n,e),Xi.subVectors(i,e),nl.subVectors(t,e);const a=_i.dot(_i),o=_i.dot(Xi),l=_i.dot(nl),h=Xi.dot(Xi),c=Xi.dot(nl),d=a*h-o*o;if(d===0)return s.set(0,0,0),null;const u=1/d,f=(h*l-o*c)*u,p=(a*c-o*l)*u;return s.set(1-f-p,p,f)}static containsPoint(t,e,i,n){return this.getBarycoord(t,e,i,n,qi)===null?!1:qi.x>=0&&qi.y>=0&&qi.x+qi.y<=1}static getInterpolation(t,e,i,n,s,a,o,l){return this.getBarycoord(t,e,i,n,qi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,qi.x),l.addScaledVector(a,qi.y),l.addScaledVector(o,qi.z),l)}static getInterpolatedAttribute(t,e,i,n,s,a){return ol.setScalar(0),ll.setScalar(0),hl.setScalar(0),ol.fromBufferAttribute(t,e),ll.fromBufferAttribute(t,i),hl.fromBufferAttribute(t,n),a.setScalar(0),a.addScaledVector(ol,s.x),a.addScaledVector(ll,s.y),a.addScaledVector(hl,s.z),a}static isFrontFacing(t,e,i,n){return _i.subVectors(i,e),Xi.subVectors(t,e),_i.cross(Xi).dot(n)<0}set(t,e,i){return this.a.copy(t),this.b.copy(e),this.c.copy(i),this}setFromPointsAndIndices(t,e,i,n){return this.a.copy(t[e]),this.b.copy(t[i]),this.c.copy(t[n]),this}setFromAttributeAndIndices(t,e,i,n){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return _i.subVectors(this.c,this.b),Xi.subVectors(this.a,this.b),_i.cross(Xi).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return js.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return js.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,i,n,s){return js.getInterpolation(t,this.a,this.b,this.c,e,i,n,s)}containsPoint(t){return js.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return js.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const i=this.a,n=this.b,s=this.c;let a,o;ys.subVectors(n,i),_s.subVectors(s,i),sl.subVectors(t,i);const l=ys.dot(sl),h=_s.dot(sl);if(l<=0&&h<=0)return e.copy(i);rl.subVectors(t,n);const c=ys.dot(rl),d=_s.dot(rl);if(c>=0&&d<=c)return e.copy(n);const u=l*d-c*h;if(u<=0&&l>=0&&c<=0)return a=l/(l-c),e.copy(i).addScaledVector(ys,a);al.subVectors(t,s);const f=ys.dot(al),p=_s.dot(al);if(p>=0&&f<=p)return e.copy(s);const x=f*h-l*p;if(x<=0&&h>=0&&p<=0)return o=h/(h-p),e.copy(i).addScaledVector(_s,o);const m=c*p-f*d;if(m<=0&&d-c>=0&&f-p>=0)return du.subVectors(s,n),o=(d-c)/(d-c+(f-p)),e.copy(n).addScaledVector(du,o);const g=1/(m+x+u);return a=x*g,o=u*g,e.copy(i).addScaledVector(ys,a).addScaledVector(_s,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},ls=class{constructor(t=new B(1/0,1/0,1/0),e=new B(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e+=3)this.expandByPoint(vi.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,i=t.count;e<i;e++)this.expandByPoint(vi.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const i=vi.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const i=t.geometry;if(i!==void 0){const s=i.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,vi):vi.fromBufferAttribute(s,a),vi.applyMatrix4(t.matrixWorld),this.expandByPoint(vi);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),ya.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),ya.copy(i.boundingBox)),ya.applyMatrix4(t.matrixWorld),this.union(ya)}const n=t.children;for(let s=0,a=n.length;s<a;s++)this.expandByObject(n[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,vi),vi.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,i;return t.normal.x>0?(e=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),e<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Tr),_a.subVectors(this.max,Tr),vs.subVectors(t.a,Tr),Ms.subVectors(t.b,Tr),bs.subVectors(t.c,Tr),gn.subVectors(Ms,vs),xn.subVectors(bs,Ms),Wn.subVectors(vs,bs);let e=[0,-gn.z,gn.y,0,-xn.z,xn.y,0,-Wn.z,Wn.y,gn.z,0,-gn.x,xn.z,0,-xn.x,Wn.z,0,-Wn.x,-gn.y,gn.x,0,-xn.y,xn.x,0,-Wn.y,Wn.x,0];return!cl(e,vs,Ms,bs,_a)||(e=[1,0,0,0,1,0,0,0,1],!cl(e,vs,Ms,bs,_a))?!1:(va.crossVectors(gn,xn),e=[va.x,va.y,va.z],cl(e,vs,Ms,bs,_a))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,vi).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(vi).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:($i[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),$i[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),$i[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),$i[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),$i[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),$i[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),$i[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),$i[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints($i),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}};const $i=[new B,new B,new B,new B,new B,new B,new B,new B],vi=new B,ya=new ls,vs=new B,Ms=new B,bs=new B,gn=new B,xn=new B,Wn=new B,Tr=new B,_a=new B,va=new B,Xn=new B;function cl(r,t,e,i,n){for(let s=0,a=r.length-3;s<=a;s+=3){Xn.fromArray(r,s);const o=n.x*Math.abs(Xn.x)+n.y*Math.abs(Xn.y)+n.z*Math.abs(Xn.z),l=t.dot(Xn),h=e.dot(Xn),c=i.dot(Xn);if(Math.max(-Math.max(l,h,c),Math.min(l,h,c))>o)return!1}return!0}const Ce=new B,Ma=new Ut;let Zm=0,Ci=class extends Bn{constructor(t,e,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Zm++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=i,this.usage=Jc,this.updateRanges=[],this.gpuType=Ei,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,i){t*=this.itemSize,i*=e.itemSize;for(let n=0,s=this.itemSize;n<s;n++)this.array[t+n]=e.array[i+n];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,i=this.count;e<i;e++)Ma.fromBufferAttribute(this,e),Ma.applyMatrix3(t),this.setXY(e,Ma.x,Ma.y);else if(this.itemSize===3)for(let e=0,i=this.count;e<i;e++)Ce.fromBufferAttribute(this,e),Ce.applyMatrix3(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}applyMatrix4(t){for(let e=0,i=this.count;e<i;e++)Ce.fromBufferAttribute(this,e),Ce.applyMatrix4(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)Ce.fromBufferAttribute(this,e),Ce.applyNormalMatrix(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)Ce.fromBufferAttribute(this,e),Ce.transformDirection(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let i=this.array[t*this.itemSize+e];return this.normalized&&(i=Qs(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=Ye(i,this.array)),this.array[t*this.itemSize+e]=i,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Qs(e,this.array)),e}setX(t,e){return this.normalized&&(e=Ye(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Qs(e,this.array)),e}setY(t,e){return this.normalized&&(e=Ye(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Qs(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Ye(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Qs(e,this.array)),e}setW(t,e){return this.normalized&&(e=Ye(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,i){return t*=this.itemSize,this.normalized&&(e=Ye(e,this.array),i=Ye(i,this.array)),this.array[t+0]=e,this.array[t+1]=i,this}setXYZ(t,e,i,n){return t*=this.itemSize,this.normalized&&(e=Ye(e,this.array),i=Ye(i,this.array),n=Ye(n,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this}setXYZW(t,e,i,n,s){return t*=this.itemSize,this.normalized&&(e=Ye(e,this.array),i=Ye(i,this.array),n=Ye(n,this.array),s=Ye(s,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Jc&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}},zf=class extends Ci{constructor(t,e,i){super(new Uint16Array(t),e,i)}},Of=class extends Ci{constructor(t,e,i){super(new Uint32Array(t),e,i)}},gi=class extends Ci{constructor(t,e,i){super(new Float32Array(t),e,i)}};const Km=new ls,Ar=new B,ul=new B;let ca=class{constructor(t=new B,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const i=this.center;e!==void 0?i.copy(e):Km.setFromPoints(t).getCenter(i);let n=0;for(let s=0,a=t.length;s<a;s++)n=Math.max(n,i.distanceToSquared(t[s]));return this.radius=Math.sqrt(n),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const i=this.center.distanceToSquared(t);return e.copy(t),i>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Ar.subVectors(t,this.center);const e=Ar.lengthSq();if(e>this.radius*this.radius){const i=Math.sqrt(e),n=(i-this.radius)*.5;this.center.addScaledVector(Ar,n/i),this.radius+=n}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(ul.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Ar.copy(t.center).add(ul)),this.expandByPoint(Ar.copy(t.center).sub(ul))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},Jm=0;const fi=new pe,dl=new Pi,Ss=new B,si=new ls,Cr=new ls,Fe=new B;let Vn=class kf extends Bn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Jm++}),this.uuid=yr(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(gm(t)?Of:zf)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,i=0){this.groups.push({start:t,count:e,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const s=new Gt().getNormalMatrix(t);i.applyNormalMatrix(s),i.needsUpdate=!0}const n=this.attributes.tangent;return n!==void 0&&(n.transformDirection(t),n.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return fi.makeRotationFromQuaternion(t),this.applyMatrix4(fi),this}rotateX(t){return fi.makeRotationX(t),this.applyMatrix4(fi),this}rotateY(t){return fi.makeRotationY(t),this.applyMatrix4(fi),this}rotateZ(t){return fi.makeRotationZ(t),this.applyMatrix4(fi),this}translate(t,e,i){return fi.makeTranslation(t,e,i),this.applyMatrix4(fi),this}scale(t,e,i){return fi.makeScale(t,e,i),this.applyMatrix4(fi),this}lookAt(t){return dl.lookAt(t),dl.updateMatrix(),this.applyMatrix4(dl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ss).negate(),this.translate(Ss.x,Ss.y,Ss.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const i=[];for(let n=0,s=t.length;n<s;n++){const a=t[n];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new gi(i,3))}else{const i=Math.min(t.length,e.count);for(let n=0;n<i;n++){const s=t[n];e.setXYZ(n,s.x,s.y,s.z||0)}t.length>e.count&&Nt("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ls);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Qt("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new B(-1/0,-1/0,-1/0),new B(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let i=0,n=e.length;i<n;i++){const s=e[i];si.setFromBufferAttribute(s),this.morphTargetsRelative?(Fe.addVectors(this.boundingBox.min,si.min),this.boundingBox.expandByPoint(Fe),Fe.addVectors(this.boundingBox.max,si.max),this.boundingBox.expandByPoint(Fe)):(this.boundingBox.expandByPoint(si.min),this.boundingBox.expandByPoint(si.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Qt('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ca);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Qt("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new B,1/0);return}if(t){const i=this.boundingSphere.center;if(si.setFromBufferAttribute(t),e)for(let s=0,a=e.length;s<a;s++){const o=e[s];Cr.setFromBufferAttribute(o),this.morphTargetsRelative?(Fe.addVectors(si.min,Cr.min),si.expandByPoint(Fe),Fe.addVectors(si.max,Cr.max),si.expandByPoint(Fe)):(si.expandByPoint(Cr.min),si.expandByPoint(Cr.max))}si.getCenter(i);let n=0;for(let s=0,a=t.count;s<a;s++)Fe.fromBufferAttribute(t,s),n=Math.max(n,i.distanceToSquared(Fe));if(e)for(let s=0,a=e.length;s<a;s++){const o=e[s],l=this.morphTargetsRelative;for(let h=0,c=o.count;h<c;h++)Fe.fromBufferAttribute(o,h),l&&(Ss.fromBufferAttribute(t,h),Fe.add(Ss)),n=Math.max(n,i.distanceToSquared(Fe))}this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&Qt('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){Qt("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=e.position,n=e.normal,s=e.uv;let a=this.getAttribute("tangent");(a===void 0||a.count!==i.count)&&(a=new Ci(new Float32Array(4*i.count),4),this.setAttribute("tangent",a));const o=[],l=[];for(let y=0;y<i.count;y++)o[y]=new B,l[y]=new B;const h=new B,c=new B,d=new B,u=new Ut,f=new Ut,p=new Ut,x=new B,m=new B;function g(y,w,C){h.fromBufferAttribute(i,y),c.fromBufferAttribute(i,w),d.fromBufferAttribute(i,C),u.fromBufferAttribute(s,y),f.fromBufferAttribute(s,w),p.fromBufferAttribute(s,C),c.sub(h),d.sub(h),f.sub(u),p.sub(u);const R=1/(f.x*p.y-p.x*f.y);isFinite(R)&&(x.copy(c).multiplyScalar(p.y).addScaledVector(d,-f.y).multiplyScalar(R),m.copy(d).multiplyScalar(f.x).addScaledVector(c,-p.x).multiplyScalar(R),o[y].add(x),o[w].add(x),o[C].add(x),l[y].add(m),l[w].add(m),l[C].add(m))}let v=this.groups;v.length===0&&(v=[{start:0,count:t.count}]);for(let y=0,w=v.length;y<w;++y){const C=v[y],R=C.start,I=C.count;for(let z=R,G=R+I;z<G;z+=3)g(t.getX(z+0),t.getX(z+1),t.getX(z+2))}const S=new B,_=new B,E=new B,b=new B;function A(y){E.fromBufferAttribute(n,y),b.copy(E);const w=o[y];S.copy(w),S.sub(E.multiplyScalar(E.dot(w))).normalize(),_.crossVectors(b,w);const R=_.dot(l[y])<0?-1:1;a.setXYZW(y,S.x,S.y,S.z,R)}for(let y=0,w=v.length;y<w;++y){const C=v[y],R=C.start,I=C.count;for(let z=R,G=R+I;z<G;z+=3)A(t.getX(z+0)),A(t.getX(z+1)),A(t.getX(z+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==e.count)i=new Ci(new Float32Array(e.count*3),3),this.setAttribute("normal",i);else for(let u=0,f=i.count;u<f;u++)i.setXYZ(u,0,0,0);const n=new B,s=new B,a=new B,o=new B,l=new B,h=new B,c=new B,d=new B;if(t)for(let u=0,f=t.count;u<f;u+=3){const p=t.getX(u+0),x=t.getX(u+1),m=t.getX(u+2);n.fromBufferAttribute(e,p),s.fromBufferAttribute(e,x),a.fromBufferAttribute(e,m),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),o.fromBufferAttribute(i,p),l.fromBufferAttribute(i,x),h.fromBufferAttribute(i,m),o.add(c),l.add(c),h.add(c),i.setXYZ(p,o.x,o.y,o.z),i.setXYZ(x,l.x,l.y,l.z),i.setXYZ(m,h.x,h.y,h.z)}else for(let u=0,f=e.count;u<f;u+=3)n.fromBufferAttribute(e,u+0),s.fromBufferAttribute(e,u+1),a.fromBufferAttribute(e,u+2),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),i.setXYZ(u+0,c.x,c.y,c.z),i.setXYZ(u+1,c.x,c.y,c.z),i.setXYZ(u+2,c.x,c.y,c.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,i=t.count;e<i;e++)Fe.fromBufferAttribute(t,e),Fe.normalize(),t.setXYZ(e,Fe.x,Fe.y,Fe.z)}toNonIndexed(){function t(o,l){const h=o.array,c=o.itemSize,d=o.normalized,u=new h.constructor(l.length*c);let f=0,p=0;for(let x=0,m=l.length;x<m;x++){o.isInterleavedBufferAttribute?f=l[x]*o.data.stride+o.offset:f=l[x]*c;for(let g=0;g<c;g++)u[p++]=h[f++]}return new Ci(u,c,d)}if(this.index===null)return Nt("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new kf,i=this.index.array,n=this.attributes;for(const o in n){const l=n[o],h=t(l,i);e.setAttribute(o,h)}const s=this.morphAttributes;for(const o in s){const l=[],h=s[o];for(let c=0,d=h.length;c<d;c++){const u=h[c],f=t(u,i);l.push(f)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const h=a[o];e.addGroup(h.start,h.count,h.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const l=this.parameters;for(const h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const i=this.attributes;for(const l in i){const h=i[l];t.data.attributes[l]=h.toJSON(t.data)}const n={};let s=!1;for(const l in this.morphAttributes){const h=this.morphAttributes[l],c=[];for(let d=0,u=h.length;d<u;d++){const f=h[d];c.push(f.toJSON(t.data))}c.length>0&&(n[l]=c,s=!0)}s&&(t.data.morphAttributes=n,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const i=t.index;i!==null&&this.setIndex(i.clone());const n=t.attributes;for(const h in n){const c=n[h];this.setAttribute(h,c.clone(e))}const s=t.morphAttributes;for(const h in s){const c=[],d=s[h];for(let u=0,f=d.length;u<f;u++)c.push(d[u].clone(e));this.morphAttributes[h]=c}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let h=0,c=a.length;h<c;h++){const d=a[h];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}},Qm=0,_r=class extends Bn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Qm++}),this.uuid=yr(),this.name="",this.type="Material",this.blending=rr,this.side=Fn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=oh,this.blendDst=lh,this.blendEquation=ts,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new zt(0,0,0),this.blendAlpha=0,this.depthFunc=dr,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Kc,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=fs,this.stencilZFail=fs,this.stencilZPass=fs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const i=t[e];if(i===void 0){Nt(`Material: parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Nt(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}n&&n.isColor?n.set(i):n&&n.isVector2&&i&&i.isVector2||n&&n.isEuler&&i&&i.isEuler||n&&n.isVector3&&i&&i.isVector3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==rr&&(i.blending=this.blending),this.side!==Fn&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==oh&&(i.blendSrc=this.blendSrc),this.blendDst!==lh&&(i.blendDst=this.blendDst),this.blendEquation!==ts&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==dr&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Kc&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==fs&&(i.stencilFail=this.stencilFail),this.stencilZFail!==fs&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==fs&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function n(s){const a=[];for(const o in s){const l=s[o];delete l.metadata,a.push(l)}return a}if(e){const s=n(t.textures),a=n(t.images);s.length>0&&(i.textures=s),a.length>0&&(i.images=a)}return i}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new zt().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new Ut().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Ut().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let i=null;if(e!==null){const n=e.length;i=new Array(n);for(let s=0;s!==n;++s)i[s]=e[s].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}};const Yi=new B,fl=new B,ba=new B,yn=new B,pl=new B,Sa=new B,ml=new B;let Ec=class{constructor(t=new B,e=new B(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Yi)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const i=e.dot(this.direction);return i<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=Yi.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(Yi.copy(this.origin).addScaledVector(this.direction,e),Yi.distanceToSquared(t))}distanceSqToSegment(t,e,i,n){fl.copy(t).add(e).multiplyScalar(.5),ba.copy(e).sub(t).normalize(),yn.copy(this.origin).sub(fl);const s=t.distanceTo(e)*.5,a=-this.direction.dot(ba),o=yn.dot(this.direction),l=-yn.dot(ba),h=yn.lengthSq(),c=Math.abs(1-a*a);let d,u,f,p;if(c>0)if(d=a*l-o,u=a*o-l,p=s*c,d>=0)if(u>=-p)if(u<=p){const x=1/c;d*=x,u*=x,f=d*(d+a*u+2*o)+u*(a*d+u+2*l)+h}else u=s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u=-s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u<=-p?(d=Math.max(0,-(-a*s+o)),u=d>0?-s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h):u<=p?(d=0,u=Math.min(Math.max(-s,-l),s),f=u*(u+2*l)+h):(d=Math.max(0,-(a*s+o)),u=d>0?s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h);else u=a>0?-s:s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;return i&&i.copy(this.origin).addScaledVector(this.direction,d),n&&n.copy(fl).addScaledVector(ba,u),f}intersectSphere(t,e){Yi.subVectors(t.center,this.origin);const i=Yi.dot(this.direction),n=Yi.dot(Yi)-i*i,s=t.radius*t.radius;if(n>s)return null;const a=Math.sqrt(s-n),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(t.normal)+t.constant)/e;return i>=0?i:null}intersectPlane(t,e){const i=this.distanceToPlane(t);return i===null?null:this.at(i,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let i,n,s,a,o,l;const h=1/this.direction.x,c=1/this.direction.y,d=1/this.direction.z,u=this.origin;return h>=0?(i=(t.min.x-u.x)*h,n=(t.max.x-u.x)*h):(i=(t.max.x-u.x)*h,n=(t.min.x-u.x)*h),c>=0?(s=(t.min.y-u.y)*c,a=(t.max.y-u.y)*c):(s=(t.max.y-u.y)*c,a=(t.min.y-u.y)*c),i>a||s>n||((s>i||isNaN(i))&&(i=s),(a<n||isNaN(n))&&(n=a),d>=0?(o=(t.min.z-u.z)*d,l=(t.max.z-u.z)*d):(o=(t.max.z-u.z)*d,l=(t.min.z-u.z)*d),i>l||o>n)||((o>i||i!==i)&&(i=o),(l<n||n!==n)&&(n=l),n<0)?null:this.at(i>=0?i:n,e)}intersectsBox(t){return this.intersectBox(t,Yi)!==null}intersectTriangle(t,e,i,n,s){pl.subVectors(e,t),Sa.subVectors(i,t),ml.crossVectors(pl,Sa);let a=this.direction.dot(ml),o;if(a>0){if(n)return null;o=1}else if(a<0)o=-1,a=-a;else return null;yn.subVectors(this.origin,t);const l=o*this.direction.dot(Sa.crossVectors(yn,Sa));if(l<0)return null;const h=o*this.direction.dot(pl.cross(yn));if(h<0||l+h>a)return null;const c=-o*yn.dot(ml);return c<0?null:this.at(c/a,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Bf=class extends _r{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new zt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new zn,this.combine=rc,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}};const fu=new pe,qn=new Ec,wa=new ca,pu=new B,Ea=new B,Ta=new B,Aa=new B,gl=new B,Ca=new B,mu=new B,Ra=new B;let Pe=class extends Pi{constructor(t=new Vn,e=new Bf){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=n.length;s<a;s++){const o=n[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(t,e){const i=this.geometry,n=i.attributes.position,s=i.morphAttributes.position,a=i.morphTargetsRelative;e.fromBufferAttribute(n,t);const o=this.morphTargetInfluences;if(s&&o){Ca.set(0,0,0);for(let l=0,h=s.length;l<h;l++){const c=o[l],d=s[l];c!==0&&(gl.fromBufferAttribute(d,t),a?Ca.addScaledVector(gl,c):Ca.addScaledVector(gl.sub(e),c))}e.add(Ca)}return e}raycast(t,e){const i=this.geometry,n=this.material,s=this.matrixWorld;n!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),wa.copy(i.boundingSphere),wa.applyMatrix4(s),qn.copy(t.ray).recast(t.near),!(wa.containsPoint(qn.origin)===!1&&(qn.intersectSphere(wa,pu)===null||qn.origin.distanceToSquared(pu)>(t.far-t.near)**2))&&(fu.copy(s).invert(),qn.copy(t.ray).applyMatrix4(fu),!(i.boundingBox!==null&&qn.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,e,qn)))}_computeIntersections(t,e,i){let n;const s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,h=s.attributes.uv,c=s.attributes.uv1,d=s.attributes.normal,u=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const m=u[p],g=a[m.materialIndex],v=Math.max(m.start,f.start),S=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let _=v,E=S;_<E;_+=3){const b=o.getX(_),A=o.getX(_+1),y=o.getX(_+2);n=Pa(this,g,t,i,h,c,d,b,A,y),n&&(n.faceIndex=Math.floor(_/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(o.count,f.start+f.count);for(let m=p,g=x;m<g;m+=3){const v=o.getX(m),S=o.getX(m+1),_=o.getX(m+2);n=Pa(this,a,t,i,h,c,d,v,S,_),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}else if(l!==void 0)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const m=u[p],g=a[m.materialIndex],v=Math.max(m.start,f.start),S=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let _=v,E=S;_<E;_+=3){const b=_,A=_+1,y=_+2;n=Pa(this,g,t,i,h,c,d,b,A,y),n&&(n.faceIndex=Math.floor(_/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(l.count,f.start+f.count);for(let m=p,g=x;m<g;m+=3){const v=m,S=m+1,_=m+2;n=Pa(this,a,t,i,h,c,d,v,S,_),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}}};function jm(r,t,e,i,n,s,a,o){let l;if(t.side===Be?l=i.intersectTriangle(a,s,n,!0,o):l=i.intersectTriangle(n,s,a,t.side===Fn,o),l===null)return null;Ra.copy(o),Ra.applyMatrix4(r.matrixWorld);const h=e.ray.origin.distanceTo(Ra);return h<e.near||h>e.far?null:{distance:h,point:Ra.clone(),object:r}}function Pa(r,t,e,i,n,s,a,o,l,h){r.getVertexPosition(o,Ea),r.getVertexPosition(l,Ta),r.getVertexPosition(h,Aa);const c=jm(r,t,e,i,Ea,Ta,Aa,mu);if(c){const d=new B;Er.getBarycoord(mu,Ea,Ta,Aa,d),n&&(c.uv=Er.getInterpolatedAttribute(n,o,l,h,d,new Ut)),s&&(c.uv1=Er.getInterpolatedAttribute(s,o,l,h,d,new Ut)),a&&(c.normal=Er.getInterpolatedAttribute(a,o,l,h,d,new B),c.normal.dot(i.direction)>0&&c.normal.multiplyScalar(-1));const u={a:o,b:l,c:h,normal:new B,materialIndex:0};Er.getNormal(Ea,Ta,Aa,u.normal),c.face=u,c.barycoord=d}return c}let Vf=class extends Ri{constructor(t=null,e=1,i=1,n,s,a,o,l,h=Oe,c=Oe,d,u){super(null,a,o,l,h,c,n,s,d,u),this.isDataTexture=!0,this.image={data:t,width:e,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},gu=class extends Ci{constructor(t,e,i,n=1){super(t,e,i),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=n}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}};const ws=new pe,xu=new pe,Ia=[],yu=new ls,t0=new pe,Rr=new Pe,Pr=new ca;let e0=class extends Pe{constructor(t,e,i){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new gu(new Float32Array(i*16),16),this.instanceColor=null,this.morphTexture=null,this.count=i,this.boundingBox=null,this.boundingSphere=null;for(let n=0;n<i;n++)this.setMatrixAt(n,t0)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new ls),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,ws),yu.copy(t.boundingBox).applyMatrix4(ws),this.boundingBox.union(yu)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new ca),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,ws),Pr.copy(t.boundingSphere).applyMatrix4(ws),this.boundingSphere.union(Pr)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const i=e.morphTargetInfluences,n=this.morphTexture.source.data.data,s=i.length+1,a=t*s+1;for(let o=0;o<i.length;o++)i[o]=n[a+o]}raycast(t,e){const i=this.matrixWorld,n=this.count;if(Rr.geometry=this.geometry,Rr.material=this.material,Rr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Pr.copy(this.boundingSphere),Pr.applyMatrix4(i),t.ray.intersectsSphere(Pr)!==!1))for(let s=0;s<n;s++){this.getMatrixAt(s,ws),xu.multiplyMatrices(i,ws),Rr.matrixWorld=xu,Rr.raycast(t,Ia);for(let a=0,o=Ia.length;a<o;a++){const l=Ia[a];l.instanceId=s,l.object=this,e.push(l)}Ia.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new gu(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){const i=e.morphTargetInfluences,n=i.length+1;this.morphTexture===null&&(this.morphTexture=new Vf(new Float32Array(n*this.count),n,this.count,pc,Ei));const s=this.morphTexture.source.data.data;let a=0;for(let h=0;h<i.length;h++)a+=i[h];const o=this.geometry.morphTargetsRelative?1:1-a,l=n*t;return s[l]=o,s.set(i,l+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}};const xl=new B,i0=new B,n0=new Gt;class Cn{constructor(t=new B(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,i,n){return this.normal.set(t,e,i),this.constant=n,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,i){const n=xl.subVectors(i,e).cross(i0.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(n,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e,i=!0){const n=t.delta(xl),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const a=-(t.start.dot(this.normal)+this.constant)/s;return i===!0&&(a<0||a>1)?null:e.copy(t.start).addScaledVector(n,a)}intersectsLine(t){const e=this.distanceToPoint(t.start),i=this.distanceToPoint(t.end);return e<0&&i>0||i<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const i=e||n0.getNormalMatrix(t),n=this.coplanarPoint(xl).applyMatrix4(t),s=this.normal.applyMatrix3(i).normalize();return this.constant=-n.dot(s),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const $n=new ca,s0=new Ut(.5,.5),Da=new B;class Tc{constructor(t=new Cn,e=new Cn,i=new Cn,n=new Cn,s=new Cn,a=new Cn){this.planes=[t,e,i,n,s,a]}set(t,e,i,n,s,a){const o=this.planes;return o[0].copy(t),o[1].copy(e),o[2].copy(i),o[3].copy(n),o[4].copy(s),o[5].copy(a),this}copy(t){const e=this.planes;for(let i=0;i<6;i++)e[i].copy(t.planes[i]);return this}setFromProjectionMatrix(t,e=ki,i=!1){const n=this.planes,s=t.elements,a=s[0],o=s[1],l=s[2],h=s[3],c=s[4],d=s[5],u=s[6],f=s[7],p=s[8],x=s[9],m=s[10],g=s[11],v=s[12],S=s[13],_=s[14],E=s[15];if(n[0].setComponents(h-a,f-c,g-p,E-v).normalize(),n[1].setComponents(h+a,f+c,g+p,E+v).normalize(),n[2].setComponents(h+o,f+d,g+x,E+S).normalize(),n[3].setComponents(h-o,f-d,g-x,E-S).normalize(),i)n[4].setComponents(l,u,m,_).normalize(),n[5].setComponents(h-l,f-u,g-m,E-_).normalize();else if(n[4].setComponents(h-l,f-u,g-m,E-_).normalize(),e===ki)n[5].setComponents(h+l,f+u,g+m,E+_).normalize();else if(e===aa)n[5].setComponents(l,u,m,_).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),$n.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),$n.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere($n)}intersectsSprite(t){$n.center.set(0,0,0);const e=s0.distanceTo(t.center);return $n.radius=.7071067811865476+e,$n.applyMatrix4(t.matrixWorld),this.intersectsSphere($n)}intersectsSphere(t){const e=this.planes,i=t.center,n=-t.radius;for(let s=0;s<6;s++)if(e[s].distanceToPoint(i)<n)return!1;return!0}intersectsBox(t){const e=this.planes;for(let i=0;i<6;i++){const n=e[i];if(Da.x=n.normal.x>0?t.max.x:t.min.x,Da.y=n.normal.y>0?t.max.y:t.min.y,Da.z=n.normal.z>0?t.max.z:t.min.z,n.distanceToPoint(Da)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let i=0;i<6;i++)if(e[i].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class Gf extends Ri{constructor(t=[],e=ss,i,n,s,a,o,l,h,c){super(t,e,i,n,s,a,o,l,h,c),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class pr extends Ri{constructor(t,e,i=Gi,n,s,a,o=Oe,l=Oe,h,c=ln,d=1){if(c!==ln&&c!==ns)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const u={width:t,height:e,depth:d};super(u,n,s,a,o,l,c,i,h),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new Mc(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}class r0 extends pr{constructor(t,e=Gi,i=ss,n,s,a=Oe,o=Oe,l,h=ln){const c={width:t,height:t,depth:1},d=[c,c,c,c,c,c];super(t,t,e,i,n,s,a,o,l,h),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}}class Hf extends Ri{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}}class hs extends Vn{constructor(t=1,e=1,i=1,n=1,s=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:i,widthSegments:n,heightSegments:s,depthSegments:a};const o=this;n=Math.floor(n),s=Math.floor(s),a=Math.floor(a);const l=[],h=[],c=[],d=[];let u=0,f=0;p("z","y","x",-1,-1,i,e,t,a,s,0),p("z","y","x",1,-1,i,e,-t,a,s,1),p("x","z","y",1,1,t,i,e,n,a,2),p("x","z","y",1,-1,t,i,-e,n,a,3),p("x","y","z",1,-1,t,e,i,n,s,4),p("x","y","z",-1,-1,t,e,-i,n,s,5),this.setIndex(l),this.setAttribute("position",new gi(h,3)),this.setAttribute("normal",new gi(c,3)),this.setAttribute("uv",new gi(d,2));function p(x,m,g,v,S,_,E,b,A,y,w){const C=_/A,R=E/y,I=_/2,z=E/2,G=b/2,L=A+1,N=y+1;let D=0,$=0;const Q=new B;for(let st=0;st<N;st++){const rt=st*R-z;for(let U=0;U<L;U++){const at=U*C-I;Q[x]=at*v,Q[m]=rt*S,Q[g]=G,h.push(Q.x,Q.y,Q.z),Q[x]=0,Q[m]=0,Q[g]=b>0?1:-1,c.push(Q.x,Q.y,Q.z),d.push(U/A),d.push(1-st/y),D+=1}}for(let st=0;st<y;st++)for(let rt=0;rt<A;rt++){const U=u+rt+L*st,at=u+rt+L*(st+1),bt=u+(rt+1)+L*(st+1),_t=u+(rt+1)+L*st;l.push(U,at,_t),l.push(at,bt,_t),$+=6}o.addGroup(f,$,w),f+=$,u+=D}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new hs(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}let Wf=class Xf extends Vn{constructor(t=1,e=1,i=1,n=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:i,heightSegments:n};const s=t/2,a=e/2,o=Math.floor(i),l=Math.floor(n),h=o+1,c=l+1,d=t/o,u=e/l,f=[],p=[],x=[],m=[];for(let g=0;g<c;g++){const v=g*u-a;for(let S=0;S<h;S++){const _=S*d-s;p.push(_,-v,0),x.push(0,0,1),m.push(S/o),m.push(1-g/l)}}for(let g=0;g<l;g++)for(let v=0;v<o;v++){const S=v+h*g,_=v+h*(g+1),E=v+1+h*(g+1),b=v+1+h*g;f.push(S,_,b),f.push(_,E,b)}this.setIndex(f),this.setAttribute("position",new gi(p,3)),this.setAttribute("normal",new gi(x,3)),this.setAttribute("uv",new gi(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Xf(t.width,t.height,t.widthSegments,t.heightSegments)}},a0=class qf extends Vn{constructor(t=1,e=32,i=16,n=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:i,phiStart:n,phiLength:s,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),i=Math.max(2,Math.floor(i));const l=Math.min(a+o,Math.PI);let h=0;const c=[],d=new B,u=new B,f=[],p=[],x=[],m=[];for(let g=0;g<=i;g++){const v=[],S=g/i,_=a+S*o,E=t*Math.cos(_),b=Math.sqrt(t*t-E*E);let A=0;g===0&&a===0?A=.5/e:g===i&&l===Math.PI&&(A=-.5/e);for(let y=0;y<=e;y++){const w=y/e,C=n+w*s;d.x=-b*Math.cos(C),d.y=E,d.z=b*Math.sin(C),p.push(d.x,d.y,d.z),u.copy(d).normalize(),x.push(u.x,u.y,u.z),m.push(w+A,1-S),v.push(h++)}c.push(v)}for(let g=0;g<i;g++)for(let v=0;v<e;v++){const S=c[g][v+1],_=c[g][v],E=c[g+1][v],b=c[g+1][v+1];(g!==0||a>0)&&f.push(S,_,b),(g!==i-1||l<Math.PI)&&f.push(_,E,b)}this.setIndex(f),this.setAttribute("position",new gi(p,3)),this.setAttribute("normal",new gi(x,3)),this.setAttribute("uv",new gi(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new qf(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}};function mr(r){const t={};for(const e in r){t[e]={};for(const i in r[e]){const n=r[e][i];if(_u(n))n.isRenderTargetTexture?(Nt("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][i]=null):t[e][i]=n.clone();else if(Array.isArray(n))if(_u(n[0])){const s=[];for(let a=0,o=n.length;a<o;a++)s[a]=n[a].clone();t[e][i]=s}else t[e][i]=n.slice();else t[e][i]=n}}return t}function Ze(r){const t={};for(let e=0;e<r.length;e++){const i=mr(r[e]);for(const n in i)t[n]=i[n]}return t}function _u(r){return r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)}function o0(r){const t=[];for(let e=0;e<r.length;e++)t.push(r[e].clone());return t}function $f(r){const t=r.getRenderTarget();return t===null?r.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Zt.workingColorSpace}const Yf={clone:mr,merge:Ze};var l0=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,h0=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;let xi=class extends _r{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=l0,this.fragmentShader=h0,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=mr(t.uniforms),this.uniformsGroups=o0(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const n in this.uniforms){const a=this.uniforms[n].value;a&&a.isTexture?e.uniforms[n]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[n]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[n]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[n]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[n]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[n]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[n]={type:"m4",value:a.toArray()}:e.uniforms[n]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const i={};for(const n in this.extensions)this.extensions[n]===!0&&(i[n]=!0);return Object.keys(i).length>0&&(e.extensions=i),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const i in t.uniforms){const n=t.uniforms[i];switch(this.uniforms[i]={},n.type){case"t":this.uniforms[i].value=e[n.value]||null;break;case"c":this.uniforms[i].value=new zt().setHex(n.value);break;case"v2":this.uniforms[i].value=new Ut().fromArray(n.value);break;case"v3":this.uniforms[i].value=new B().fromArray(n.value);break;case"v4":this.uniforms[i].value=new Te().fromArray(n.value);break;case"m3":this.uniforms[i].value=new Gt().fromArray(n.value);break;case"m4":this.uniforms[i].value=new pe().fromArray(n.value);break;default:this.uniforms[i].value=n.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}};class c0 extends xi{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}}class vu extends _r{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new zt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new zt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Do,this.normalScale=new Ut(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new zn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class u0 extends _r{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new zt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new zt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Do,this.normalScale=new Ut(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new zn,this.combine=rc,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.envMapIntensity=t.envMapIntensity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class d0 extends _r{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=lm,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class f0 extends _r{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}class p0 extends Pi{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new zt(t),this.intensity=e}dispose(){this.dispatchEvent({type:"dispose"})}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,e}}const yl=new pe,Mu=new B,bu=new B;class m0{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ut(512,512),this.mapType=ui,this.map=null,this.mapPass=null,this.matrix=new pe,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Tc,this._frameExtents=new Ut(1,1),this._viewportCount=1,this._viewports=[new Te(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,i=this.matrix;Mu.setFromMatrixPosition(t.matrixWorld),e.position.copy(Mu),bu.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(bu),e.updateMatrixWorld(),yl.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(yl,e.coordinateSystem,e.reversedDepth),e.coordinateSystem===aa||e.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(yl)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this.biasNode=t.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}const La=new B,Na=new Un,Ni=new B;let Zf=class extends Pi{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new pe,this.projectionMatrix=new pe,this.projectionMatrixInverse=new pe,this.coordinateSystem=ki,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(La,Na,Ni),Ni.x===1&&Ni.y===1&&Ni.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(La,Na,Ni.set(1,1,1)).invert()}updateWorldMatrix(t,e,i=!1){super.updateWorldMatrix(t,e,i),this.matrixWorld.decompose(La,Na,Ni),Ni.x===1&&Ni.y===1&&Ni.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(La,Na,Ni.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}};const _n=new B,Su=new Ut,wu=new Ut;class hi extends Zf{constructor(t=50,e=1,i=.1,n=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=i,this.far=n,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=oa*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(Qr*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return oa*2*Math.atan(Math.tan(Qr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,i){_n.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(_n.x,_n.y).multiplyScalar(-t/_n.z),_n.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(_n.x,_n.y).multiplyScalar(-t/_n.z)}getViewSize(t,e){return this.getViewBounds(t,Su,wu),e.subVectors(wu,Su)}setViewOffset(t,e,i,n,s,a){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(Qr*.5*this.fov)/this.zoom,i=2*e,n=this.aspect*i,s=-.5*n;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,h=a.fullHeight;s+=a.offsetX*n/l,e-=a.offsetY*i/h,n*=a.width/l,i*=a.height/h}const o=this.filmOffset;o!==0&&(s+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+n,e,e-i,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}class g0 extends m0{constructor(){super(new hi(90,1,.5,500)),this.isPointLightShadow=!0}}class x0 extends p0{constructor(t,e,i=0,n=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=i,this.decay=n,this.shadow=new g0}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}toJSON(t){const e=super.toJSON(t);return e.object.distance=this.distance,e.object.decay=this.decay,e.object.shadow=this.shadow.toJSON(),e}}let Ac=class extends Zf{constructor(t=-1,e=1,i=1,n=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=i,this.bottom=n,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,i,n,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,n=(this.top+this.bottom)/2;let s=i-t,a=i+t,o=n+e,l=n-e;if(this.view!==null&&this.view.enabled){const h=(this.right-this.left)/this.view.fullWidth/this.zoom,c=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=h*this.view.offsetX,a=s+h*this.view.width,o-=c*this.view.offsetY,l=o-c*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}};const Es=-90,Ts=1;class y0 extends Pi{constructor(t,e,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;const n=new hi(Es,Ts,t,e);n.layers=this.layers,this.add(n);const s=new hi(Es,Ts,t,e);s.layers=this.layers,this.add(s);const a=new hi(Es,Ts,t,e);a.layers=this.layers,this.add(a);const o=new hi(Es,Ts,t,e);o.layers=this.layers,this.add(o);const l=new hi(Es,Ts,t,e);l.layers=this.layers,this.add(l);const h=new hi(Es,Ts,t,e);h.layers=this.layers,this.add(h)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[i,n,s,a,o,l]=e;for(const h of e)this.remove(h);if(t===ki)i.up.set(0,1,0),i.lookAt(1,0,0),n.up.set(0,1,0),n.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===aa)i.up.set(0,-1,0),i.lookAt(-1,0,0),n.up.set(0,-1,0),n.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const h of e)this.add(h),h.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:i,activeMipmapLevel:n}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[s,a,o,l,h,c]=this.children,d=t.getRenderTarget(),u=t.getActiveCubeFace(),f=t.getActiveMipmapLevel(),p=t.xr.enabled;t.xr.enabled=!1;const x=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let m=!1;t.isWebGLRenderer===!0?m=t.state.buffers.depth.getReversed():m=t.reversedDepthBuffer,t.setRenderTarget(i,0,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,s),t.setRenderTarget(i,1,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,a),t.setRenderTarget(i,2,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,o),t.setRenderTarget(i,3,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,l),t.setRenderTarget(i,4,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,h),i.texture.generateMipmaps=x,t.setRenderTarget(i,5,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,c),t.setRenderTarget(d,u,f),t.xr.enabled=p,i.texture.needsPMREMUpdate=!0}}class _0 extends hi{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}}const Eu=new pe;class v0{constructor(t,e,i=0,n=1/0){this.ray=new Ec(t,e),this.near=i,this.far=n,this.camera=null,this.layers=new bc,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,e.projectionMatrix.elements[14]).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):Qt("Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return Eu.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Eu),this}intersectObject(t,e=!0,i=[]){return Kh(t,this,i,e),i.sort(Tu),i}intersectObjects(t,e=!0,i=[]){for(let n=0,s=t.length;n<s;n++)Kh(t[n],this,i,e);return i.sort(Tu),i}}function Tu(r,t){return r.distance-t.distance}function Kh(r,t,e,i){let n=!0;if(r.layers.test(t.layers)&&r.raycast(t,e)===!1&&(n=!1),n===!0&&i===!0){const s=r.children;for(let a=0,o=s.length;a<o;a++)Kh(s[a],t,e,!0)}}class M0{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1,Nt("Clock: This module has been deprecated. Please use THREE.Timer instead.")}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const e=performance.now();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}}class Au{constructor(t=1,e=0,i=0){this.radius=t,this.phi=e,this.theta=i}set(t,e,i){return this.radius=t,this.phi=e,this.theta=i,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=$t(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,i){return this.radius=Math.sqrt(t*t+e*e+i*i),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,i),this.phi=Math.acos($t(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}let H1=class Kf{static{Kf.prototype.isMatrix2=!0}constructor(t,e,i,n){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,i,n)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let i=0;i<4;i++)this.elements[i]=t[i+e];return this}set(t,e,i,n){const s=this.elements;return s[0]=t,s[2]=e,s[1]=i,s[3]=n,this}};class Jf extends Bn{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(t){if(t===void 0){Nt("Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=t}disconnect(){}dispose(){}update(){}}function Cu(r,t,e,i){const n=b0(i);switch(e){case Af:return r*t;case pc:return r*t/n.components*n.byteLength;case mc:return r*t/n.components*n.byteLength;case rs:return r*t*2/n.components*n.byteLength;case gc:return r*t*2/n.components*n.byteLength;case Cf:return r*t*3/n.components*n.byteLength;case Ti:return r*t*4/n.components*n.byteLength;case xc:return r*t*4/n.components*n.byteLength;case yo:case _o:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*8;case vo:case Mo:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case _h:case Mh:return Math.max(r,16)*Math.max(t,8)/4;case yh:case vh:return Math.max(r,8)*Math.max(t,8)/2;case bh:case Sh:case Eh:case Th:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*8;case wh:case Po:case Ah:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case Ch:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case Rh:return Math.floor((r+4)/5)*Math.floor((t+3)/4)*16;case Ph:return Math.floor((r+4)/5)*Math.floor((t+4)/5)*16;case Ih:return Math.floor((r+5)/6)*Math.floor((t+4)/5)*16;case Dh:return Math.floor((r+5)/6)*Math.floor((t+5)/6)*16;case Lh:return Math.floor((r+7)/8)*Math.floor((t+4)/5)*16;case Nh:return Math.floor((r+7)/8)*Math.floor((t+5)/6)*16;case Fh:return Math.floor((r+7)/8)*Math.floor((t+7)/8)*16;case Uh:return Math.floor((r+9)/10)*Math.floor((t+4)/5)*16;case zh:return Math.floor((r+9)/10)*Math.floor((t+5)/6)*16;case Oh:return Math.floor((r+9)/10)*Math.floor((t+7)/8)*16;case kh:return Math.floor((r+9)/10)*Math.floor((t+9)/10)*16;case Bh:return Math.floor((r+11)/12)*Math.floor((t+9)/10)*16;case Vh:return Math.floor((r+11)/12)*Math.floor((t+11)/12)*16;case Gh:case Hh:case Wh:return Math.ceil(r/4)*Math.ceil(t/4)*16;case Xh:case qh:return Math.ceil(r/4)*Math.ceil(t/4)*8;case Io:case $h:return Math.ceil(r/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function b0(r){switch(r){case ui:case Sf:return{byteLength:1,components:1};case sa:case wf:case on:return{byteLength:2,components:1};case dc:case fc:return{byteLength:2,components:4};case Gi:case uc:case Ei:return{byteLength:4,components:1};case Ef:case Tf:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${r}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:sc}}));typeof window<"u"&&(window.__THREE__?Nt("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=sc);/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function Qf(){let r=null,t=!1,e=null,i=null;function n(s,a){e(s,a),i=r.requestAnimationFrame(n)}return{start:function(){t!==!0&&e!==null&&r!==null&&(i=r.requestAnimationFrame(n),t=!0)},stop:function(){r!==null&&r.cancelAnimationFrame(i),t=!1},setAnimationLoop:function(s){e=s},setContext:function(s){r=s}}}function S0(r){const t=new WeakMap;function e(o,l){const h=o.array,c=o.usage,d=h.byteLength,u=r.createBuffer();r.bindBuffer(l,u),r.bufferData(l,h,c),o.onUploadCallback();let f;if(h instanceof Float32Array)f=r.FLOAT;else if(typeof Float16Array<"u"&&h instanceof Float16Array)f=r.HALF_FLOAT;else if(h instanceof Uint16Array)o.isFloat16BufferAttribute?f=r.HALF_FLOAT:f=r.UNSIGNED_SHORT;else if(h instanceof Int16Array)f=r.SHORT;else if(h instanceof Uint32Array)f=r.UNSIGNED_INT;else if(h instanceof Int32Array)f=r.INT;else if(h instanceof Int8Array)f=r.BYTE;else if(h instanceof Uint8Array)f=r.UNSIGNED_BYTE;else if(h instanceof Uint8ClampedArray)f=r.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+h);return{buffer:u,type:f,bytesPerElement:h.BYTES_PER_ELEMENT,version:o.version,size:d}}function i(o,l,h){const c=l.array,d=l.updateRanges;if(r.bindBuffer(h,o),d.length===0)r.bufferSubData(h,0,c);else{d.sort((f,p)=>f.start-p.start);let u=0;for(let f=1;f<d.length;f++){const p=d[u],x=d[f];x.start<=p.start+p.count+1?p.count=Math.max(p.count,x.start+x.count-p.start):(++u,d[u]=x)}d.length=u+1;for(let f=0,p=d.length;f<p;f++){const x=d[f];r.bufferSubData(h,x.start*c.BYTES_PER_ELEMENT,c,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function n(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=t.get(o);l&&(r.deleteBuffer(l.buffer),t.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const c=t.get(o);(!c||c.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const h=t.get(o);if(h===void 0)t.set(o,e(o,l));else if(h.version<o.version){if(h.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(h.buffer,o,l),h.version=o.version}}return{get:n,remove:s,update:a}}var w0=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,E0=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,T0=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,A0=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,C0=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,R0=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,P0=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,I0=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,D0=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,L0=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,N0=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,F0=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,U0=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,z0=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,O0=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,k0=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,B0=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,V0=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,G0=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,H0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,W0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,X0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,q0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,$0=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Y0=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Z0=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,K0=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,J0=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Q0=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,j0=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,tg="gl_FragColor = linearToOutputTexel( gl_FragColor );",eg=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,ig=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,ng=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,sg=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,rg=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,ag=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,og=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,lg=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,hg=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,cg=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,ug=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,dg=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,fg=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,pg=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,mg=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,gg=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,xg=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,yg=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,_g=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,vg=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Mg=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,bg=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Sg=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,wg=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Eg=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Tg=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,Ag=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Cg=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Rg=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Pg=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Ig=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Dg=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Lg=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Ng=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Fg=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Ug=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,zg=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Og=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,kg=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Bg=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Vg=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Gg=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,Hg=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,Wg=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Xg=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,qg=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,$g=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Yg=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Zg=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Kg=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Jg=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Qg=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,jg=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,tx=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,ex=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,ix=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,nx=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,sx=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,rx=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,ax=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,ox=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,lx=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,hx=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,cx=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,ux=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,dx=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,fx=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,px=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,mx=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,gx=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,xx=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,yx=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,_x=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,vx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Mx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,bx=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,Sx=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const wx=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Ex=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Tx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Ax=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Cx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Rx=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Px=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Ix=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Dx=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Lx=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,Nx=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Fx=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Ux=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,zx=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Ox=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,kx=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Bx=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Vx=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Gx=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Hx=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Wx=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Xx=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,qx=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,$x=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Yx=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Zx=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Kx=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Jx=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Qx=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,jx=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,ty=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,ey=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,iy=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,ny=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Xt={alphahash_fragment:w0,alphahash_pars_fragment:E0,alphamap_fragment:T0,alphamap_pars_fragment:A0,alphatest_fragment:C0,alphatest_pars_fragment:R0,aomap_fragment:P0,aomap_pars_fragment:I0,batching_pars_vertex:D0,batching_vertex:L0,begin_vertex:N0,beginnormal_vertex:F0,bsdfs:U0,iridescence_fragment:z0,bumpmap_pars_fragment:O0,clipping_planes_fragment:k0,clipping_planes_pars_fragment:B0,clipping_planes_pars_vertex:V0,clipping_planes_vertex:G0,color_fragment:H0,color_pars_fragment:W0,color_pars_vertex:X0,color_vertex:q0,common:$0,cube_uv_reflection_fragment:Y0,defaultnormal_vertex:Z0,displacementmap_pars_vertex:K0,displacementmap_vertex:J0,emissivemap_fragment:Q0,emissivemap_pars_fragment:j0,colorspace_fragment:tg,colorspace_pars_fragment:eg,envmap_fragment:ig,envmap_common_pars_fragment:ng,envmap_pars_fragment:sg,envmap_pars_vertex:rg,envmap_physical_pars_fragment:gg,envmap_vertex:ag,fog_vertex:og,fog_pars_vertex:lg,fog_fragment:hg,fog_pars_fragment:cg,gradientmap_pars_fragment:ug,lightmap_pars_fragment:dg,lights_lambert_fragment:fg,lights_lambert_pars_fragment:pg,lights_pars_begin:mg,lights_toon_fragment:xg,lights_toon_pars_fragment:yg,lights_phong_fragment:_g,lights_phong_pars_fragment:vg,lights_physical_fragment:Mg,lights_physical_pars_fragment:bg,lights_fragment_begin:Sg,lights_fragment_maps:wg,lights_fragment_end:Eg,lightprobes_pars_fragment:Tg,logdepthbuf_fragment:Ag,logdepthbuf_pars_fragment:Cg,logdepthbuf_pars_vertex:Rg,logdepthbuf_vertex:Pg,map_fragment:Ig,map_pars_fragment:Dg,map_particle_fragment:Lg,map_particle_pars_fragment:Ng,metalnessmap_fragment:Fg,metalnessmap_pars_fragment:Ug,morphinstance_vertex:zg,morphcolor_vertex:Og,morphnormal_vertex:kg,morphtarget_pars_vertex:Bg,morphtarget_vertex:Vg,normal_fragment_begin:Gg,normal_fragment_maps:Hg,normal_pars_fragment:Wg,normal_pars_vertex:Xg,normal_vertex:qg,normalmap_pars_fragment:$g,clearcoat_normal_fragment_begin:Yg,clearcoat_normal_fragment_maps:Zg,clearcoat_pars_fragment:Kg,iridescence_pars_fragment:Jg,opaque_fragment:Qg,packing:jg,premultiplied_alpha_fragment:tx,project_vertex:ex,dithering_fragment:ix,dithering_pars_fragment:nx,roughnessmap_fragment:sx,roughnessmap_pars_fragment:rx,shadowmap_pars_fragment:ax,shadowmap_pars_vertex:ox,shadowmap_vertex:lx,shadowmask_pars_fragment:hx,skinbase_vertex:cx,skinning_pars_vertex:ux,skinning_vertex:dx,skinnormal_vertex:fx,specularmap_fragment:px,specularmap_pars_fragment:mx,tonemapping_fragment:gx,tonemapping_pars_fragment:xx,transmission_fragment:yx,transmission_pars_fragment:_x,uv_pars_fragment:vx,uv_pars_vertex:Mx,uv_vertex:bx,worldpos_vertex:Sx,background_vert:wx,background_frag:Ex,backgroundCube_vert:Tx,backgroundCube_frag:Ax,cube_vert:Cx,cube_frag:Rx,depth_vert:Px,depth_frag:Ix,distance_vert:Dx,distance_frag:Lx,equirect_vert:Nx,equirect_frag:Fx,linedashed_vert:Ux,linedashed_frag:zx,meshbasic_vert:Ox,meshbasic_frag:kx,meshlambert_vert:Bx,meshlambert_frag:Vx,meshmatcap_vert:Gx,meshmatcap_frag:Hx,meshnormal_vert:Wx,meshnormal_frag:Xx,meshphong_vert:qx,meshphong_frag:$x,meshphysical_vert:Yx,meshphysical_frag:Zx,meshtoon_vert:Kx,meshtoon_frag:Jx,points_vert:Qx,points_frag:jx,shadow_vert:ty,shadow_frag:ey,sprite_vert:iy,sprite_frag:ny},pt={common:{diffuse:{value:new zt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Gt},alphaMap:{value:null},alphaMapTransform:{value:new Gt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Gt}},envmap:{envMap:{value:null},envMapRotation:{value:new Gt},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Gt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Gt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Gt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Gt},normalScale:{value:new Ut(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Gt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Gt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Gt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Gt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new zt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new B},probesMax:{value:new B},probesResolution:{value:new B}},points:{diffuse:{value:new zt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Gt},alphaTest:{value:0},uvTransform:{value:new Gt}},sprite:{diffuse:{value:new zt(16777215)},opacity:{value:1},center:{value:new Ut(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Gt},alphaMap:{value:null},alphaMapTransform:{value:new Gt},alphaTest:{value:0}}},zi={basic:{uniforms:Ze([pt.common,pt.specularmap,pt.envmap,pt.aomap,pt.lightmap,pt.fog]),vertexShader:Xt.meshbasic_vert,fragmentShader:Xt.meshbasic_frag},lambert:{uniforms:Ze([pt.common,pt.specularmap,pt.envmap,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.fog,pt.lights,{emissive:{value:new zt(0)},envMapIntensity:{value:1}}]),vertexShader:Xt.meshlambert_vert,fragmentShader:Xt.meshlambert_frag},phong:{uniforms:Ze([pt.common,pt.specularmap,pt.envmap,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.fog,pt.lights,{emissive:{value:new zt(0)},specular:{value:new zt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Xt.meshphong_vert,fragmentShader:Xt.meshphong_frag},standard:{uniforms:Ze([pt.common,pt.envmap,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.roughnessmap,pt.metalnessmap,pt.fog,pt.lights,{emissive:{value:new zt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Xt.meshphysical_vert,fragmentShader:Xt.meshphysical_frag},toon:{uniforms:Ze([pt.common,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.gradientmap,pt.fog,pt.lights,{emissive:{value:new zt(0)}}]),vertexShader:Xt.meshtoon_vert,fragmentShader:Xt.meshtoon_frag},matcap:{uniforms:Ze([pt.common,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.fog,{matcap:{value:null}}]),vertexShader:Xt.meshmatcap_vert,fragmentShader:Xt.meshmatcap_frag},points:{uniforms:Ze([pt.points,pt.fog]),vertexShader:Xt.points_vert,fragmentShader:Xt.points_frag},dashed:{uniforms:Ze([pt.common,pt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Xt.linedashed_vert,fragmentShader:Xt.linedashed_frag},depth:{uniforms:Ze([pt.common,pt.displacementmap]),vertexShader:Xt.depth_vert,fragmentShader:Xt.depth_frag},normal:{uniforms:Ze([pt.common,pt.bumpmap,pt.normalmap,pt.displacementmap,{opacity:{value:1}}]),vertexShader:Xt.meshnormal_vert,fragmentShader:Xt.meshnormal_frag},sprite:{uniforms:Ze([pt.sprite,pt.fog]),vertexShader:Xt.sprite_vert,fragmentShader:Xt.sprite_frag},background:{uniforms:{uvTransform:{value:new Gt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Xt.background_vert,fragmentShader:Xt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Gt}},vertexShader:Xt.backgroundCube_vert,fragmentShader:Xt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Xt.cube_vert,fragmentShader:Xt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Xt.equirect_vert,fragmentShader:Xt.equirect_frag},distance:{uniforms:Ze([pt.common,pt.displacementmap,{referencePosition:{value:new B},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Xt.distance_vert,fragmentShader:Xt.distance_frag},shadow:{uniforms:Ze([pt.lights,pt.fog,{color:{value:new zt(0)},opacity:{value:1}}]),vertexShader:Xt.shadow_vert,fragmentShader:Xt.shadow_frag}};zi.physical={uniforms:Ze([zi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Gt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Gt},clearcoatNormalScale:{value:new Ut(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Gt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Gt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Gt},sheen:{value:0},sheenColor:{value:new zt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Gt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Gt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Gt},transmissionSamplerSize:{value:new Ut},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Gt},attenuationDistance:{value:0},attenuationColor:{value:new zt(0)},specularColor:{value:new zt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Gt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Gt},anisotropyVector:{value:new Ut},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Gt}}]),vertexShader:Xt.meshphysical_vert,fragmentShader:Xt.meshphysical_frag};const Fa={r:0,b:0,g:0},sy=new pe,jf=new Gt;jf.set(-1,0,0,0,1,0,0,0,1);function ry(r,t,e,i,n,s){const a=new zt(0);let o=n===!0?0:1,l,h,c=null,d=0,u=null;function f(v){let S=v.isScene===!0?v.background:null;if(S&&S.isTexture){const _=v.backgroundBlurriness>0;S=t.get(S,_)}return S}function p(v){let S=!1;const _=f(v);_===null?m(a,o):_&&_.isColor&&(m(_,1),S=!0);const E=r.xr.getEnvironmentBlendMode();E==="additive"?e.buffers.color.setClear(0,0,0,1,s):E==="alpha-blend"&&e.buffers.color.setClear(0,0,0,0,s),(r.autoClear||S)&&(e.buffers.depth.setTest(!0),e.buffers.depth.setMask(!0),e.buffers.color.setMask(!0),r.clear(r.autoClearColor,r.autoClearDepth,r.autoClearStencil))}function x(v,S){const _=f(S);_&&(_.isCubeTexture||_.mapping===Go)?(h===void 0&&(h=new Pe(new hs(1,1,1),new xi({name:"BackgroundCubeMaterial",uniforms:mr(zi.backgroundCube.uniforms),vertexShader:zi.backgroundCube.vertexShader,fragmentShader:zi.backgroundCube.fragmentShader,side:Be,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(E,b,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),h.material.uniforms.envMap.value=_,h.material.uniforms.backgroundBlurriness.value=S.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(sy.makeRotationFromEuler(S.backgroundRotation)).transpose(),_.isCubeTexture&&_.isRenderTargetTexture===!1&&h.material.uniforms.backgroundRotation.value.premultiply(jf),h.material.toneMapped=Zt.getTransfer(_.colorSpace)!==ie,(c!==_||d!==_.version||u!==r.toneMapping)&&(h.material.needsUpdate=!0,c=_,d=_.version,u=r.toneMapping),h.layers.enableAll(),v.unshift(h,h.geometry,h.material,0,0,null)):_&&_.isTexture&&(l===void 0&&(l=new Pe(new Wf(2,2),new xi({name:"BackgroundMaterial",uniforms:mr(zi.background.uniforms),vertexShader:zi.background.vertexShader,fragmentShader:zi.background.fragmentShader,side:Fn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=_,l.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,l.material.toneMapped=Zt.getTransfer(_.colorSpace)!==ie,_.matrixAutoUpdate===!0&&_.updateMatrix(),l.material.uniforms.uvTransform.value.copy(_.matrix),(c!==_||d!==_.version||u!==r.toneMapping)&&(l.material.needsUpdate=!0,c=_,d=_.version,u=r.toneMapping),l.layers.enableAll(),v.unshift(l,l.geometry,l.material,0,0,null))}function m(v,S){v.getRGB(Fa,$f(r)),e.buffers.color.setClear(Fa.r,Fa.g,Fa.b,S,s)}function g(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(v,S=1){a.set(v),o=S,m(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(v){o=v,m(a,o)},render:p,addToRenderList:x,dispose:g}}function ay(r,t){const e=r.getParameter(r.MAX_VERTEX_ATTRIBS),i={},n=u(null);let s=n,a=!1;function o(R,I,z,G,L){let N=!1;const D=d(R,G,z,I);s!==D&&(s=D,h(s.object)),N=f(R,G,z,L),N&&p(R,G,z,L),L!==null&&t.update(L,r.ELEMENT_ARRAY_BUFFER),(N||a)&&(a=!1,_(R,I,z,G),L!==null&&r.bindBuffer(r.ELEMENT_ARRAY_BUFFER,t.get(L).buffer))}function l(){return r.createVertexArray()}function h(R){return r.bindVertexArray(R)}function c(R){return r.deleteVertexArray(R)}function d(R,I,z,G){const L=G.wireframe===!0;let N=i[I.id];N===void 0&&(N={},i[I.id]=N);const D=R.isInstancedMesh===!0?R.id:0;let $=N[D];$===void 0&&($={},N[D]=$);let Q=$[z.id];Q===void 0&&(Q={},$[z.id]=Q);let st=Q[L];return st===void 0&&(st=u(l()),Q[L]=st),st}function u(R){const I=[],z=[],G=[];for(let L=0;L<e;L++)I[L]=0,z[L]=0,G[L]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:z,attributeDivisors:G,object:R,attributes:{},index:null}}function f(R,I,z,G){const L=s.attributes,N=I.attributes;let D=0;const $=z.getAttributes();for(const Q in $)if($[Q].location>=0){const rt=L[Q];let U=N[Q];if(U===void 0&&(Q==="instanceMatrix"&&R.instanceMatrix&&(U=R.instanceMatrix),Q==="instanceColor"&&R.instanceColor&&(U=R.instanceColor)),rt===void 0||rt.attribute!==U||U&&rt.data!==U.data)return!0;D++}return s.attributesNum!==D||s.index!==G}function p(R,I,z,G){const L={},N=I.attributes;let D=0;const $=z.getAttributes();for(const Q in $)if($[Q].location>=0){let rt=N[Q];rt===void 0&&(Q==="instanceMatrix"&&R.instanceMatrix&&(rt=R.instanceMatrix),Q==="instanceColor"&&R.instanceColor&&(rt=R.instanceColor));const U={};U.attribute=rt,rt&&rt.data&&(U.data=rt.data),L[Q]=U,D++}s.attributes=L,s.attributesNum=D,s.index=G}function x(){const R=s.newAttributes;for(let I=0,z=R.length;I<z;I++)R[I]=0}function m(R){g(R,0)}function g(R,I){const z=s.newAttributes,G=s.enabledAttributes,L=s.attributeDivisors;z[R]=1,G[R]===0&&(r.enableVertexAttribArray(R),G[R]=1),L[R]!==I&&(r.vertexAttribDivisor(R,I),L[R]=I)}function v(){const R=s.newAttributes,I=s.enabledAttributes;for(let z=0,G=I.length;z<G;z++)I[z]!==R[z]&&(r.disableVertexAttribArray(z),I[z]=0)}function S(R,I,z,G,L,N,D){D===!0?r.vertexAttribIPointer(R,I,z,L,N):r.vertexAttribPointer(R,I,z,G,L,N)}function _(R,I,z,G){x();const L=G.attributes,N=z.getAttributes(),D=I.defaultAttributeValues;for(const $ in N){const Q=N[$];if(Q.location>=0){let st=L[$];if(st===void 0&&($==="instanceMatrix"&&R.instanceMatrix&&(st=R.instanceMatrix),$==="instanceColor"&&R.instanceColor&&(st=R.instanceColor)),st!==void 0){const rt=st.normalized,U=st.itemSize,at=t.get(st);if(at===void 0)continue;const bt=at.buffer,_t=at.type,X=at.bytesPerElement,nt=_t===r.INT||_t===r.UNSIGNED_INT||st.gpuType===uc;if(st.isInterleavedBufferAttribute){const et=st.data,Rt=et.stride,Dt=st.offset;if(et.isInstancedInterleavedBuffer){for(let yt=0;yt<Q.locationSize;yt++)g(Q.location+yt,et.meshPerAttribute);R.isInstancedMesh!==!0&&G._maxInstanceCount===void 0&&(G._maxInstanceCount=et.meshPerAttribute*et.count)}else for(let yt=0;yt<Q.locationSize;yt++)m(Q.location+yt);r.bindBuffer(r.ARRAY_BUFFER,bt);for(let yt=0;yt<Q.locationSize;yt++)S(Q.location+yt,U/Q.locationSize,_t,rt,Rt*X,(Dt+U/Q.locationSize*yt)*X,nt)}else{if(st.isInstancedBufferAttribute){for(let et=0;et<Q.locationSize;et++)g(Q.location+et,st.meshPerAttribute);R.isInstancedMesh!==!0&&G._maxInstanceCount===void 0&&(G._maxInstanceCount=st.meshPerAttribute*st.count)}else for(let et=0;et<Q.locationSize;et++)m(Q.location+et);r.bindBuffer(r.ARRAY_BUFFER,bt);for(let et=0;et<Q.locationSize;et++)S(Q.location+et,U/Q.locationSize,_t,rt,U*X,U/Q.locationSize*et*X,nt)}}else if(D!==void 0){const rt=D[$];if(rt!==void 0)switch(rt.length){case 2:r.vertexAttrib2fv(Q.location,rt);break;case 3:r.vertexAttrib3fv(Q.location,rt);break;case 4:r.vertexAttrib4fv(Q.location,rt);break;default:r.vertexAttrib1fv(Q.location,rt)}}}}v()}function E(){w();for(const R in i){const I=i[R];for(const z in I){const G=I[z];for(const L in G){const N=G[L];for(const D in N)c(N[D].object),delete N[D];delete G[L]}}delete i[R]}}function b(R){if(i[R.id]===void 0)return;const I=i[R.id];for(const z in I){const G=I[z];for(const L in G){const N=G[L];for(const D in N)c(N[D].object),delete N[D];delete G[L]}}delete i[R.id]}function A(R){for(const I in i){const z=i[I];for(const G in z){const L=z[G];if(L[R.id]===void 0)continue;const N=L[R.id];for(const D in N)c(N[D].object),delete N[D];delete L[R.id]}}}function y(R){for(const I in i){const z=i[I],G=R.isInstancedMesh===!0?R.id:0,L=z[G];if(L!==void 0){for(const N in L){const D=L[N];for(const $ in D)c(D[$].object),delete D[$];delete L[N]}delete z[G],Object.keys(z).length===0&&delete i[I]}}}function w(){C(),a=!0,s!==n&&(s=n,h(s.object))}function C(){n.geometry=null,n.program=null,n.wireframe=!1}return{setup:o,reset:w,resetDefaultState:C,dispose:E,releaseStatesOfGeometry:b,releaseStatesOfObject:y,releaseStatesOfProgram:A,initAttributes:x,enableAttribute:m,disableUnusedAttributes:v}}function oy(r,t,e){let i;function n(l){i=l}function s(l,h){r.drawArrays(i,l,h),e.update(h,i,1)}function a(l,h,c){c!==0&&(r.drawArraysInstanced(i,l,h,c),e.update(h,i,c))}function o(l,h,c){if(c===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,h,0,c);let u=0;for(let f=0;f<c;f++)u+=h[f];e.update(u,i,1)}this.setMode=n,this.render=s,this.renderInstances=a,this.renderMultiDraw=o}function ly(r,t,e,i){let n;function s(){if(n!==void 0)return n;if(t.has("EXT_texture_filter_anisotropic")===!0){const A=t.get("EXT_texture_filter_anisotropic");n=r.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function a(A){return!(A!==Ti&&i.convert(A)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(A){const y=A===on&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(A!==ui&&i.convert(A)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==Ei&&!y)}function l(A){if(A==="highp"){if(r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.HIGH_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.MEDIUM_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let h=e.precision!==void 0?e.precision:"highp";const c=l(h);c!==h&&(Nt("WebGLRenderer:",h,"not supported, using",c,"instead."),h=c);const d=e.logarithmicDepthBuffer===!0,u=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control");e.reversedDepthBuffer===!0&&u===!1&&Nt("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");const f=r.getParameter(r.MAX_TEXTURE_IMAGE_UNITS),p=r.getParameter(r.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=r.getParameter(r.MAX_TEXTURE_SIZE),m=r.getParameter(r.MAX_CUBE_MAP_TEXTURE_SIZE),g=r.getParameter(r.MAX_VERTEX_ATTRIBS),v=r.getParameter(r.MAX_VERTEX_UNIFORM_VECTORS),S=r.getParameter(r.MAX_VARYING_VECTORS),_=r.getParameter(r.MAX_FRAGMENT_UNIFORM_VECTORS),E=r.getParameter(r.MAX_SAMPLES),b=r.getParameter(r.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:h,logarithmicDepthBuffer:d,reversedDepthBuffer:u,maxTextures:f,maxVertexTextures:p,maxTextureSize:x,maxCubemapSize:m,maxAttributes:g,maxVertexUniforms:v,maxVaryings:S,maxFragmentUniforms:_,maxSamples:E,samples:b}}function hy(r){const t=this;let e=null,i=0,n=!1,s=!1;const a=new Cn,o=new Gt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,u){const f=d.length!==0||u||i!==0||n;return n=u,i=d.length,f},this.beginShadows=function(){s=!0,c(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,u){e=c(d,u,0)},this.setState=function(d,u,f){const p=d.clippingPlanes,x=d.clipIntersection,m=d.clipShadows,g=r.get(d);if(!n||p===null||p.length===0||s&&!m)s?c(null):h();else{const v=s?0:i,S=v*4;let _=g.clippingState||null;l.value=_,_=c(p,u,S,f);for(let E=0;E!==S;++E)_[E]=e[E];g.clippingState=_,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=v}};function h(){l.value!==e&&(l.value=e,l.needsUpdate=i>0),t.numPlanes=i,t.numIntersection=0}function c(d,u,f,p){const x=d!==null?d.length:0;let m=null;if(x!==0){if(m=l.value,p!==!0||m===null){const g=f+x*4,v=u.matrixWorldInverse;o.getNormalMatrix(v),(m===null||m.length<g)&&(m=new Float32Array(g));for(let S=0,_=f;S!==x;++S,_+=4)a.copy(d[S]).applyMatrix4(v,o),a.normal.toArray(m,_),m[_+3]=a.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=x,t.numIntersection=0,m}}const Dn=4,Ru=[.125,.215,.35,.446,.526,.582],es=20,cy=256,Ir=new Ac,Pu=new zt;let _l=null,vl=0,Ml=0,bl=!1;const uy=new B;class Jh{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,e=0,i=.1,n=100,s={}){const{size:a=256,position:o=uy}=s;_l=this._renderer.getRenderTarget(),vl=this._renderer.getActiveCubeFace(),Ml=this._renderer.getActiveMipmapLevel(),bl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);const l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,i,n,l,o),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Lu(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Du(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(_l,vl,Ml),this._renderer.xr.enabled=bl,t.scissorTest=!1,As(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===ss||t.mapping===fr?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),_l=this._renderer.getRenderTarget(),vl=this._renderer.getActiveCubeFace(),Ml=this._renderer.getActiveMipmapLevel(),bl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const i=e||this._allocateTargets();return this._textureToCubeUV(t,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,i={magFilter:qe,minFilter:qe,generateMipmaps:!1,type:on,format:Ti,colorSpace:Lo,depthBuffer:!1},n=Iu(t,e,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Iu(t,e,i);const{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=dy(s)),this._blurMaterial=py(s,t,e),this._ggxMaterial=fy(s,t,e)}return n}_compileMaterial(t){const e=new Pe(new Vn,t);this._renderer.compile(e,Ir)}_sceneToCubeUV(t,e,i,n,s){const l=new hi(90,1,e,i),h=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],d=this._renderer,u=d.autoClear,f=d.toneMapping;d.getClearColor(Pu),d.toneMapping=Ai,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(n),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Pe(new hs,new Bf({name:"PMREM.Background",side:Be,depthWrite:!1,depthTest:!1})));const x=this._backgroundBox,m=x.material;let g=!1;const v=t.background;v?v.isColor&&(m.color.copy(v),t.background=null,g=!0):(m.color.copy(Pu),g=!0);for(let S=0;S<6;S++){const _=S%3;_===0?(l.up.set(0,h[S],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+c[S],s.y,s.z)):_===1?(l.up.set(0,0,h[S]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+c[S],s.z)):(l.up.set(0,h[S],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+c[S]));const E=this._cubeSize;As(n,_*E,S>2?E:0,E,E),d.setRenderTarget(n),g&&d.render(x,l),d.render(t,l)}d.toneMapping=f,d.autoClear=u,t.background=v}_textureToCubeUV(t,e){const i=this._renderer,n=t.mapping===ss||t.mapping===fr;n?(this._cubemapMaterial===null&&(this._cubemapMaterial=Lu()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Du());const s=n?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=s;const o=s.uniforms;o.envMap.value=t;const l=this._cubeSize;As(e,0,0,3*l,2*l),i.setRenderTarget(e),i.render(a,Ir)}_applyPMREM(t){const e=this._renderer,i=e.autoClear;e.autoClear=!1;const n=this._lodMeshes.length;for(let s=1;s<n;s++)this._applyGGXFilter(t,s-1,s);e.autoClear=i}_applyGGXFilter(t,e,i){const n=this._renderer,s=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[i];o.material=a;const l=a.uniforms,h=i/(this._lodMeshes.length-1),c=e/(this._lodMeshes.length-1),d=Math.sqrt(h*h-c*c),u=0+h*1.25,f=d*u,{_lodMax:p}=this,x=this._sizeLods[i],m=3*x*(i>p-Dn?i-p+Dn:0),g=4*(this._cubeSize-x);l.envMap.value=t.texture,l.roughness.value=f,l.mipInt.value=p-e,As(s,m,g,3*x,2*x),n.setRenderTarget(s),n.render(o,Ir),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=p-i,As(t,m,g,3*x,2*x),n.setRenderTarget(t),n.render(o,Ir)}_blur(t,e,i,n,s){const a=this._pingPongRenderTarget;this._halfBlur(t,a,e,i,n,"latitudinal",s),this._halfBlur(a,t,i,i,n,"longitudinal",s)}_halfBlur(t,e,i,n,s,a,o){const l=this._renderer,h=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&Qt("blur direction must be either latitudinal or longitudinal!");const c=3,d=this._lodMeshes[n];d.material=h;const u=h.uniforms,f=this._sizeLods[i]-1,p=isFinite(s)?Math.PI/(2*f):2*Math.PI/(2*es-1),x=s/p,m=isFinite(s)?1+Math.floor(c*x):es;m>es&&Nt(`sigmaRadians, ${s}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${es}`);const g=[];let v=0;for(let A=0;A<es;++A){const y=A/x,w=Math.exp(-y*y/2);g.push(w),A===0?v+=w:A<m&&(v+=2*w)}for(let A=0;A<g.length;A++)g[A]=g[A]/v;u.envMap.value=t.texture,u.samples.value=m,u.weights.value=g,u.latitudinal.value=a==="latitudinal",o&&(u.poleAxis.value=o);const{_lodMax:S}=this;u.dTheta.value=p,u.mipInt.value=S-i;const _=this._sizeLods[n],E=3*_*(n>S-Dn?n-S+Dn:0),b=4*(this._cubeSize-_);As(e,E,b,3*_,2*_),l.setRenderTarget(e),l.render(d,Ir)}}function dy(r){const t=[],e=[],i=[];let n=r;const s=r-Dn+1+Ru.length;for(let a=0;a<s;a++){const o=Math.pow(2,n);t.push(o);let l=1/o;a>r-Dn?l=Ru[a-r+Dn-1]:a===0&&(l=0),e.push(l);const h=1/(o-2),c=-h,d=1+h,u=[c,c,d,c,d,d,c,c,d,d,c,d],f=6,p=6,x=3,m=2,g=1,v=new Float32Array(x*p*f),S=new Float32Array(m*p*f),_=new Float32Array(g*p*f);for(let b=0;b<f;b++){const A=b%3*2/3-1,y=b>2?0:-1,w=[A,y,0,A+2/3,y,0,A+2/3,y+1,0,A,y,0,A+2/3,y+1,0,A,y+1,0];v.set(w,x*p*b),S.set(u,m*p*b);const C=[b,b,b,b,b,b];_.set(C,g*p*b)}const E=new Vn;E.setAttribute("position",new Ci(v,x)),E.setAttribute("uv",new Ci(S,m)),E.setAttribute("faceIndex",new Ci(_,g)),i.push(new Pe(E,null)),n>Dn&&n--}return{lodMeshes:i,sizeLods:t,sigmas:e}}function Iu(r,t,e){const i=new Bi(r,t,e);return i.texture.mapping=Go,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function As(r,t,e,i,n){r.viewport.set(t,e,i,n),r.scissor.set(t,e,i,n)}function fy(r,t,e){return new xi({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:cy,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Ho(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:sn,depthTest:!1,depthWrite:!1})}function py(r,t,e){const i=new Float32Array(es),n=new B(0,1,0);return new xi({name:"SphericalGaussianBlur",defines:{n:es,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:n}},vertexShader:Ho(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:sn,depthTest:!1,depthWrite:!1})}function Du(){return new xi({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Ho(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:sn,depthTest:!1,depthWrite:!1})}function Lu(){return new xi({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Ho(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:sn,depthTest:!1,depthWrite:!1})}function Ho(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}class tp extends Bi{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const i={width:t,height:t,depth:1},n=[i,i,i,i,i,i];this.texture=new Gf(n),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const i={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},n=new hs(5,5,5),s=new xi({name:"CubemapFromEquirect",uniforms:mr(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Be,blending:sn});s.uniforms.tEquirect.value=e;const a=new Pe(n,s),o=e.minFilter;return e.minFilter===is&&(e.minFilter=qe),new y0(1,10,this).update(t,a),e.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(t,e=!0,i=!0,n=!0){const s=t.getRenderTarget();for(let a=0;a<6;a++)t.setRenderTarget(this,a),t.clear(e,i,n);t.setRenderTarget(s)}}function my(r){let t=new WeakMap,e=new WeakMap,i=null;function n(u,f=!1){return u==null?null:f?a(u):s(u)}function s(u){if(u&&u.isTexture){const f=u.mapping;if(f===Jr||f===Yo)if(t.has(u)){const p=t.get(u).texture;return o(p,u.mapping)}else{const p=u.image;if(p&&p.height>0){const x=new tp(p.height);return x.fromEquirectangularTexture(r,u),t.set(u,x),u.addEventListener("dispose",h),o(x.texture,u.mapping)}else return null}}return u}function a(u){if(u&&u.isTexture){const f=u.mapping,p=f===Jr||f===Yo,x=f===ss||f===fr;if(p||x){let m=e.get(u);const g=m!==void 0?m.texture.pmremVersion:0;if(u.isRenderTargetTexture&&u.pmremVersion!==g)return i===null&&(i=new Jh(r)),m=p?i.fromEquirectangular(u,m):i.fromCubemap(u,m),m.texture.pmremVersion=u.pmremVersion,e.set(u,m),m.texture;if(m!==void 0)return m.texture;{const v=u.image;return p&&v&&v.height>0||x&&v&&l(v)?(i===null&&(i=new Jh(r)),m=p?i.fromEquirectangular(u):i.fromCubemap(u),m.texture.pmremVersion=u.pmremVersion,e.set(u,m),u.addEventListener("dispose",c),m.texture):null}}}return u}function o(u,f){return f===Jr?u.mapping=ss:f===Yo&&(u.mapping=fr),u}function l(u){let f=0;const p=6;for(let x=0;x<p;x++)u[x]!==void 0&&f++;return f===p}function h(u){const f=u.target;f.removeEventListener("dispose",h);const p=t.get(f);p!==void 0&&(t.delete(f),p.dispose())}function c(u){const f=u.target;f.removeEventListener("dispose",c);const p=e.get(f);p!==void 0&&(e.delete(f),p.dispose())}function d(){t=new WeakMap,e=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:n,dispose:d}}function gy(r){const t={};function e(i){if(t[i]!==void 0)return t[i];const n=r.getExtension(i);return t[i]=n,n}return{has:function(i){return e(i)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(i){const n=e(i);return n===null&&ar("WebGLRenderer: "+i+" extension not supported."),n}}}function xy(r,t,e,i){const n={},s=new WeakMap;function a(d){const u=d.target;u.index!==null&&t.remove(u.index);for(const p in u.attributes)t.remove(u.attributes[p]);u.removeEventListener("dispose",a),delete n[u.id];const f=s.get(u);f&&(t.remove(f),s.delete(u)),i.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,e.memory.geometries--}function o(d,u){return n[u.id]===!0||(u.addEventListener("dispose",a),n[u.id]=!0,e.memory.geometries++),u}function l(d){const u=d.attributes;for(const f in u)t.update(u[f],r.ARRAY_BUFFER)}function h(d){const u=[],f=d.index,p=d.attributes.position;let x=0;if(p===void 0)return;if(f!==null){const v=f.array;x=f.version;for(let S=0,_=v.length;S<_;S+=3){const E=v[S+0],b=v[S+1],A=v[S+2];u.push(E,b,b,A,A,E)}}else{const v=p.array;x=p.version;for(let S=0,_=v.length/3-1;S<_;S+=3){const E=S+0,b=S+1,A=S+2;u.push(E,b,b,A,A,E)}}const m=new(p.count>=65535?Of:zf)(u,1);m.version=x;const g=s.get(d);g&&t.remove(g),s.set(d,m)}function c(d){const u=s.get(d);if(u){const f=d.index;f!==null&&u.version<f.version&&h(d)}else h(d);return s.get(d)}return{get:o,update:l,getWireframeAttribute:c}}function yy(r,t,e){let i;function n(d){i=d}let s,a;function o(d){s=d.type,a=d.bytesPerElement}function l(d,u){r.drawElements(i,u,s,d*a),e.update(u,i,1)}function h(d,u,f){f!==0&&(r.drawElementsInstanced(i,u,s,d*a,f),e.update(u,i,f))}function c(d,u,f){if(f===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,u,0,s,d,0,f);let x=0;for(let m=0;m<f;m++)x+=u[m];e.update(x,i,1)}this.setMode=n,this.setIndex=o,this.render=l,this.renderInstances=h,this.renderMultiDraw=c}function _y(r){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,a,o){switch(e.calls++,a){case r.TRIANGLES:e.triangles+=o*(s/3);break;case r.LINES:e.lines+=o*(s/2);break;case r.LINE_STRIP:e.lines+=o*(s-1);break;case r.LINE_LOOP:e.lines+=o*s;break;case r.POINTS:e.points+=o*s;break;default:Qt("WebGLInfo: Unknown draw mode:",a);break}}function n(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:n,update:i}}function vy(r,t,e){const i=new WeakMap,n=new Te;function s(a,o,l){const h=a.morphTargetInfluences,c=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,d=c!==void 0?c.length:0;let u=i.get(o);if(u===void 0||u.count!==d){let w=function(){A.dispose(),i.delete(o),o.removeEventListener("dispose",w)};u!==void 0&&u.texture.dispose();const f=o.morphAttributes.position!==void 0,p=o.morphAttributes.normal!==void 0,x=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],g=o.morphAttributes.normal||[],v=o.morphAttributes.color||[];let S=0;f===!0&&(S=1),p===!0&&(S=2),x===!0&&(S=3);let _=o.attributes.position.count*S,E=1;_>t.maxTextureSize&&(E=Math.ceil(_/t.maxTextureSize),_=t.maxTextureSize);const b=new Float32Array(_*E*4*d),A=new Nf(b,_,E,d);A.type=Ei,A.needsUpdate=!0;const y=S*4;for(let C=0;C<d;C++){const R=m[C],I=g[C],z=v[C],G=_*E*4*C;for(let L=0;L<R.count;L++){const N=L*y;f===!0&&(n.fromBufferAttribute(R,L),b[G+N+0]=n.x,b[G+N+1]=n.y,b[G+N+2]=n.z,b[G+N+3]=0),p===!0&&(n.fromBufferAttribute(I,L),b[G+N+4]=n.x,b[G+N+5]=n.y,b[G+N+6]=n.z,b[G+N+7]=0),x===!0&&(n.fromBufferAttribute(z,L),b[G+N+8]=n.x,b[G+N+9]=n.y,b[G+N+10]=n.z,b[G+N+11]=z.itemSize===4?n.w:1)}}u={count:d,texture:A,size:new Ut(_,E)},i.set(o,u),o.addEventListener("dispose",w)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(r,"morphTexture",a.morphTexture,e);else{let f=0;for(let x=0;x<h.length;x++)f+=h[x];const p=o.morphTargetsRelative?1:1-f;l.getUniforms().setValue(r,"morphTargetBaseInfluence",p),l.getUniforms().setValue(r,"morphTargetInfluences",h)}l.getUniforms().setValue(r,"morphTargetsTexture",u.texture,e),l.getUniforms().setValue(r,"morphTargetsTextureSize",u.size)}return{update:s}}function My(r,t,e,i,n){let s=new WeakMap;function a(h){const c=n.render.frame,d=h.geometry,u=t.get(h,d);if(s.get(u)!==c&&(t.update(u),s.set(u,c)),h.isInstancedMesh&&(h.hasEventListener("dispose",l)===!1&&h.addEventListener("dispose",l),s.get(h)!==c&&(e.update(h.instanceMatrix,r.ARRAY_BUFFER),h.instanceColor!==null&&e.update(h.instanceColor,r.ARRAY_BUFFER),s.set(h,c))),h.isSkinnedMesh){const f=h.skeleton;s.get(f)!==c&&(f.update(),s.set(f,c))}return u}function o(){s=new WeakMap}function l(h){const c=h.target;c.removeEventListener("dispose",l),i.releaseStatesOfObject(c),e.remove(c.instanceMatrix),c.instanceColor!==null&&e.remove(c.instanceColor)}return{update:a,dispose:o}}const by={[ac]:"LINEAR_TONE_MAPPING",[oc]:"REINHARD_TONE_MAPPING",[lc]:"CINEON_TONE_MAPPING",[hc]:"ACES_FILMIC_TONE_MAPPING",[cc]:"AGX_TONE_MAPPING",[Vo]:"NEUTRAL_TONE_MAPPING",[Mf]:"CUSTOM_TONE_MAPPING"};function Sy(r,t,e,i,n,s){const a=new Bi(t,e,{type:r,depthBuffer:n,stencilBuffer:s,samples:i?4:0,depthTexture:n?new pr(t,e):void 0}),o=new Bi(t,e,{type:on,depthBuffer:!1,stencilBuffer:!1}),l=new Vn;l.setAttribute("position",new gi([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute("uv",new gi([0,2,0,0,2,0],2));const h=new c0({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),c=new Pe(l,h),d=new Ac(-1,1,1,-1,0,1);let u=null,f=null,p=!1,x,m=null,g=[],v=!1;this.setSize=function(S,_){a.setSize(S,_),o.setSize(S,_);for(let E=0;E<g.length;E++){const b=g[E];b.setSize&&b.setSize(S,_)}},this.setEffects=function(S){g=S,v=g.length>0&&g[0].isRenderPass===!0;const _=a.width,E=a.height;for(let b=0;b<g.length;b++){const A=g[b];A.setSize&&A.setSize(_,E)}},this.begin=function(S,_){if(p||S.toneMapping===Ai&&g.length===0)return!1;if(m=_,_!==null){const E=_.width,b=_.height;(a.width!==E||a.height!==b)&&this.setSize(E,b)}return v===!1&&S.setRenderTarget(a),x=S.toneMapping,S.toneMapping=Ai,!0},this.hasRenderPass=function(){return v},this.end=function(S,_){S.toneMapping=x,p=!0;let E=a,b=o;for(let A=0;A<g.length;A++){const y=g[A];if(y.enabled!==!1&&(y.render(S,b,E,_),y.needsSwap!==!1)){const w=E;E=b,b=w}}if(u!==S.outputColorSpace||f!==S.toneMapping){u=S.outputColorSpace,f=S.toneMapping,h.defines={},Zt.getTransfer(u)===ie&&(h.defines.SRGB_TRANSFER="");const A=by[f];A&&(h.defines[A]=""),h.needsUpdate=!0}h.uniforms.tDiffuse.value=E.texture,S.setRenderTarget(m),S.render(c,d),m=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){a.depthTexture&&a.depthTexture.dispose(),a.dispose(),o.dispose(),l.dispose(),h.dispose()}}const ep=new Ri,Qh=new pr(1,1),ip=new Nf,np=new Vm,sp=new Gf,Nu=[],Fu=[],Uu=new Float32Array(16),zu=new Float32Array(9),Ou=new Float32Array(4);function vr(r,t,e){const i=r[0];if(i<=0||i>0)return r;const n=t*e;let s=Nu[n];if(s===void 0&&(s=new Float32Array(n),Nu[n]=s),t!==0){i.toArray(s,0);for(let a=1,o=0;a!==t;++a)o+=e,r[a].toArray(s,o)}return s}function Le(r,t){if(r.length!==t.length)return!1;for(let e=0,i=r.length;e<i;e++)if(r[e]!==t[e])return!1;return!0}function Ne(r,t){for(let e=0,i=t.length;e<i;e++)r[e]=t[e]}function Wo(r,t){let e=Fu[t];e===void 0&&(e=new Int32Array(t),Fu[t]=e);for(let i=0;i!==t;++i)e[i]=r.allocateTextureUnit();return e}function wy(r,t){const e=this.cache;e[0]!==t&&(r.uniform1f(this.addr,t),e[0]=t)}function Ey(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Le(e,t))return;r.uniform2fv(this.addr,t),Ne(e,t)}}function Ty(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(r.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(Le(e,t))return;r.uniform3fv(this.addr,t),Ne(e,t)}}function Ay(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Le(e,t))return;r.uniform4fv(this.addr,t),Ne(e,t)}}function Cy(r,t){const e=this.cache,i=t.elements;if(i===void 0){if(Le(e,t))return;r.uniformMatrix2fv(this.addr,!1,t),Ne(e,t)}else{if(Le(e,i))return;Ou.set(i),r.uniformMatrix2fv(this.addr,!1,Ou),Ne(e,i)}}function Ry(r,t){const e=this.cache,i=t.elements;if(i===void 0){if(Le(e,t))return;r.uniformMatrix3fv(this.addr,!1,t),Ne(e,t)}else{if(Le(e,i))return;zu.set(i),r.uniformMatrix3fv(this.addr,!1,zu),Ne(e,i)}}function Py(r,t){const e=this.cache,i=t.elements;if(i===void 0){if(Le(e,t))return;r.uniformMatrix4fv(this.addr,!1,t),Ne(e,t)}else{if(Le(e,i))return;Uu.set(i),r.uniformMatrix4fv(this.addr,!1,Uu),Ne(e,i)}}function Iy(r,t){const e=this.cache;e[0]!==t&&(r.uniform1i(this.addr,t),e[0]=t)}function Dy(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Le(e,t))return;r.uniform2iv(this.addr,t),Ne(e,t)}}function Ly(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Le(e,t))return;r.uniform3iv(this.addr,t),Ne(e,t)}}function Ny(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Le(e,t))return;r.uniform4iv(this.addr,t),Ne(e,t)}}function Fy(r,t){const e=this.cache;e[0]!==t&&(r.uniform1ui(this.addr,t),e[0]=t)}function Uy(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Le(e,t))return;r.uniform2uiv(this.addr,t),Ne(e,t)}}function zy(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Le(e,t))return;r.uniform3uiv(this.addr,t),Ne(e,t)}}function Oy(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Le(e,t))return;r.uniform4uiv(this.addr,t),Ne(e,t)}}function ky(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n);let s;this.type===r.SAMPLER_2D_SHADOW?(Qh.compareFunction=e.isReversedDepthBuffer()?_c:yc,s=Qh):s=ep,e.setTexture2D(t||s,n)}function By(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n),e.setTexture3D(t||np,n)}function Vy(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n),e.setTextureCube(t||sp,n)}function Gy(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n),e.setTexture2DArray(t||ip,n)}function Hy(r){switch(r){case 5126:return wy;case 35664:return Ey;case 35665:return Ty;case 35666:return Ay;case 35674:return Cy;case 35675:return Ry;case 35676:return Py;case 5124:case 35670:return Iy;case 35667:case 35671:return Dy;case 35668:case 35672:return Ly;case 35669:case 35673:return Ny;case 5125:return Fy;case 36294:return Uy;case 36295:return zy;case 36296:return Oy;case 35678:case 36198:case 36298:case 36306:case 35682:return ky;case 35679:case 36299:case 36307:return By;case 35680:case 36300:case 36308:case 36293:return Vy;case 36289:case 36303:case 36311:case 36292:return Gy}}function Wy(r,t){r.uniform1fv(this.addr,t)}function Xy(r,t){const e=vr(t,this.size,2);r.uniform2fv(this.addr,e)}function qy(r,t){const e=vr(t,this.size,3);r.uniform3fv(this.addr,e)}function $y(r,t){const e=vr(t,this.size,4);r.uniform4fv(this.addr,e)}function Yy(r,t){const e=vr(t,this.size,4);r.uniformMatrix2fv(this.addr,!1,e)}function Zy(r,t){const e=vr(t,this.size,9);r.uniformMatrix3fv(this.addr,!1,e)}function Ky(r,t){const e=vr(t,this.size,16);r.uniformMatrix4fv(this.addr,!1,e)}function Jy(r,t){r.uniform1iv(this.addr,t)}function Qy(r,t){r.uniform2iv(this.addr,t)}function jy(r,t){r.uniform3iv(this.addr,t)}function t_(r,t){r.uniform4iv(this.addr,t)}function e_(r,t){r.uniform1uiv(this.addr,t)}function i_(r,t){r.uniform2uiv(this.addr,t)}function n_(r,t){r.uniform3uiv(this.addr,t)}function s_(r,t){r.uniform4uiv(this.addr,t)}function r_(r,t,e){const i=this.cache,n=t.length,s=Wo(e,n);Le(i,s)||(r.uniform1iv(this.addr,s),Ne(i,s));let a;this.type===r.SAMPLER_2D_SHADOW?a=Qh:a=ep;for(let o=0;o!==n;++o)e.setTexture2D(t[o]||a,s[o])}function a_(r,t,e){const i=this.cache,n=t.length,s=Wo(e,n);Le(i,s)||(r.uniform1iv(this.addr,s),Ne(i,s));for(let a=0;a!==n;++a)e.setTexture3D(t[a]||np,s[a])}function o_(r,t,e){const i=this.cache,n=t.length,s=Wo(e,n);Le(i,s)||(r.uniform1iv(this.addr,s),Ne(i,s));for(let a=0;a!==n;++a)e.setTextureCube(t[a]||sp,s[a])}function l_(r,t,e){const i=this.cache,n=t.length,s=Wo(e,n);Le(i,s)||(r.uniform1iv(this.addr,s),Ne(i,s));for(let a=0;a!==n;++a)e.setTexture2DArray(t[a]||ip,s[a])}function h_(r){switch(r){case 5126:return Wy;case 35664:return Xy;case 35665:return qy;case 35666:return $y;case 35674:return Yy;case 35675:return Zy;case 35676:return Ky;case 5124:case 35670:return Jy;case 35667:case 35671:return Qy;case 35668:case 35672:return jy;case 35669:case 35673:return t_;case 5125:return e_;case 36294:return i_;case 36295:return n_;case 36296:return s_;case 35678:case 36198:case 36298:case 36306:case 35682:return r_;case 35679:case 36299:case 36307:return a_;case 35680:case 36300:case 36308:case 36293:return o_;case 36289:case 36303:case 36311:case 36292:return l_}}class c_{constructor(t,e,i){this.id=t,this.addr=i,this.cache=[],this.type=e.type,this.setValue=Hy(e.type)}}class u_{constructor(t,e,i){this.id=t,this.addr=i,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=h_(e.type)}}class d_{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,i){const n=this.seq;for(let s=0,a=n.length;s!==a;++s){const o=n[s];o.setValue(t,e[o.id],i)}}}const Sl=/(\w+)(\])?(\[|\.)?/g;function ku(r,t){r.seq.push(t),r.map[t.id]=t}function f_(r,t,e){const i=r.name,n=i.length;for(Sl.lastIndex=0;;){const s=Sl.exec(i),a=Sl.lastIndex;let o=s[1];const l=s[2]==="]",h=s[3];if(l&&(o=o|0),h===void 0||h==="["&&a+2===n){ku(e,h===void 0?new c_(o,r,t):new u_(o,r,t));break}else{let d=e.map[o];d===void 0&&(d=new d_(o),ku(e,d)),e=d}}}class Eo{constructor(t,e){this.seq=[],this.map={};const i=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let a=0;a<i;++a){const o=t.getActiveUniform(e,a),l=t.getUniformLocation(e,o.name);f_(o,l,this)}const n=[],s=[];for(const a of this.seq)a.type===t.SAMPLER_2D_SHADOW||a.type===t.SAMPLER_CUBE_SHADOW||a.type===t.SAMPLER_2D_ARRAY_SHADOW?n.push(a):s.push(a);n.length>0&&(this.seq=n.concat(s))}setValue(t,e,i,n){const s=this.map[e];s!==void 0&&s.setValue(t,i,n)}setOptional(t,e,i){const n=e[i];n!==void 0&&this.setValue(t,i,n)}static upload(t,e,i,n){for(let s=0,a=e.length;s!==a;++s){const o=e[s],l=i[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,n)}}static seqWithValue(t,e){const i=[];for(let n=0,s=t.length;n!==s;++n){const a=t[n];a.id in e&&i.push(a)}return i}}function Bu(r,t,e){const i=r.createShader(t);return r.shaderSource(i,e),r.compileShader(i),i}const p_=37297;let m_=0;function g_(r,t){const e=r.split(`
`),i=[],n=Math.max(t-6,0),s=Math.min(t+6,e.length);for(let a=n;a<s;a++){const o=a+1;i.push(`${o===t?">":" "} ${o}: ${e[a]}`)}return i.join(`
`)}const Vu=new Gt;function x_(r){Zt._getMatrix(Vu,Zt.workingColorSpace,r);const t=`mat3( ${Vu.elements.map(e=>e.toFixed(4))} )`;switch(Zt.getTransfer(r)){case No:return[t,"LinearTransferOETF"];case ie:return[t,"sRGBTransferOETF"];default:return Nt("WebGLProgram: Unsupported color space: ",r),[t,"LinearTransferOETF"]}}function Gu(r,t,e){const i=r.getShaderParameter(t,r.COMPILE_STATUS),s=(r.getShaderInfoLog(t)||"").trim();if(i&&s==="")return"";const a=/ERROR: 0:(\d+)/.exec(s);if(a){const o=parseInt(a[1]);return e.toUpperCase()+`

`+s+`

`+g_(r.getShaderSource(t),o)}else return s}function y_(r,t){const e=x_(t);return[`vec4 ${r}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}const __={[ac]:"Linear",[oc]:"Reinhard",[lc]:"Cineon",[hc]:"ACESFilmic",[cc]:"AgX",[Vo]:"Neutral",[Mf]:"Custom"};function v_(r,t){const e=__[t];return e===void 0?(Nt("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+r+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+r+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const Ua=new B;function M_(){Zt.getLuminanceCoefficients(Ua);const r=Ua.x.toFixed(4),t=Ua.y.toFixed(4),e=Ua.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${r}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function b_(r){return[r.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",r.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter($r).join(`
`)}function S_(r){const t=[];for(const e in r){const i=r[e];i!==!1&&t.push("#define "+e+" "+i)}return t.join(`
`)}function w_(r,t){const e={},i=r.getProgramParameter(t,r.ACTIVE_ATTRIBUTES);for(let n=0;n<i;n++){const s=r.getActiveAttrib(t,n),a=s.name;let o=1;s.type===r.FLOAT_MAT2&&(o=2),s.type===r.FLOAT_MAT3&&(o=3),s.type===r.FLOAT_MAT4&&(o=4),e[a]={type:s.type,location:r.getAttribLocation(t,a),locationSize:o}}return e}function $r(r){return r!==""}function Hu(r,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return r.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function Wu(r,t){return r.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const E_=/^[ \t]*#include +<([\w\d./]+)>/gm;function jh(r){return r.replace(E_,A_)}const T_=new Map;function A_(r,t){let e=Xt[t];if(e===void 0){const i=T_.get(t);if(i!==void 0)e=Xt[i],Nt('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,i);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return jh(e)}const C_=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Xu(r){return r.replace(C_,R_)}function R_(r,t,e,i){let n="";for(let s=parseInt(t);s<parseInt(e);s++)n+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return n}function qu(r){let t=`precision ${r.precision} float;
	precision ${r.precision} int;
	precision ${r.precision} sampler2D;
	precision ${r.precision} samplerCube;
	precision ${r.precision} sampler3D;
	precision ${r.precision} sampler2DArray;
	precision ${r.precision} sampler2DShadow;
	precision ${r.precision} samplerCubeShadow;
	precision ${r.precision} sampler2DArrayShadow;
	precision ${r.precision} isampler2D;
	precision ${r.precision} isampler3D;
	precision ${r.precision} isamplerCube;
	precision ${r.precision} isampler2DArray;
	precision ${r.precision} usampler2D;
	precision ${r.precision} usampler3D;
	precision ${r.precision} usamplerCube;
	precision ${r.precision} usampler2DArray;
	`;return r.precision==="highp"?t+=`
#define HIGH_PRECISION`:r.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:r.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}const P_={[xo]:"SHADOWMAP_TYPE_PCF",[qr]:"SHADOWMAP_TYPE_VSM"};function I_(r){return P_[r.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}const D_={[ss]:"ENVMAP_TYPE_CUBE",[fr]:"ENVMAP_TYPE_CUBE",[Go]:"ENVMAP_TYPE_CUBE_UV"};function L_(r){return r.envMap===!1?"ENVMAP_TYPE_CUBE":D_[r.envMapMode]||"ENVMAP_TYPE_CUBE"}const N_={[fr]:"ENVMAP_MODE_REFRACTION"};function F_(r){return r.envMap===!1?"ENVMAP_MODE_REFLECTION":N_[r.envMapMode]||"ENVMAP_MODE_REFLECTION"}const U_={[rc]:"ENVMAP_BLENDING_MULTIPLY",[rm]:"ENVMAP_BLENDING_MIX",[am]:"ENVMAP_BLENDING_ADD"};function z_(r){return r.envMap===!1?"ENVMAP_BLENDING_NONE":U_[r.combine]||"ENVMAP_BLENDING_NONE"}function O_(r){const t=r.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,i=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:i,maxMip:e}}function k_(r,t,e,i){const n=r.getContext(),s=e.defines;let a=e.vertexShader,o=e.fragmentShader;const l=I_(e),h=L_(e),c=F_(e),d=z_(e),u=O_(e),f=b_(e),p=S_(s),x=n.createProgram();let m,g,v=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p].filter($r).join(`
`),m.length>0&&(m+=`
`),g=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p].filter($r).join(`
`),g.length>0&&(g+=`
`)):(m=[qu(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexNormals?"#define HAS_NORMAL":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter($r).join(`
`),g=[qu(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.envMap?"#define "+c:"",e.envMap?"#define "+d:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor?"#define USE_COLOR":"",e.vertexAlphas||e.batchingColor?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==Ai?"#define TONE_MAPPING":"",e.toneMapping!==Ai?Xt.tonemapping_pars_fragment:"",e.toneMapping!==Ai?v_("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Xt.colorspace_pars_fragment,y_("linearToOutputTexel",e.outputColorSpace),M_(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter($r).join(`
`)),a=jh(a),a=Hu(a,e),a=Wu(a,e),o=jh(o),o=Hu(o,e),o=Wu(o,e),a=Xu(a),o=Xu(o),e.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,g=["#define varying in",e.glslVersion===Qc?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===Qc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+g);const S=v+m+a,_=v+g+o,E=Bu(n,n.VERTEX_SHADER,S),b=Bu(n,n.FRAGMENT_SHADER,_);n.attachShader(x,E),n.attachShader(x,b),e.index0AttributeName!==void 0?n.bindAttribLocation(x,0,e.index0AttributeName):e.hasPositionAttribute===!0&&n.bindAttribLocation(x,0,"position"),n.linkProgram(x);function A(R){if(r.debug.checkShaderErrors){const I=n.getProgramInfoLog(x)||"",z=n.getShaderInfoLog(E)||"",G=n.getShaderInfoLog(b)||"",L=I.trim(),N=z.trim(),D=G.trim();let $=!0,Q=!0;if(n.getProgramParameter(x,n.LINK_STATUS)===!1)if($=!1,typeof r.debug.onShaderError=="function")r.debug.onShaderError(n,x,E,b);else{const st=Gu(n,E,"vertex"),rt=Gu(n,b,"fragment");Qt("WebGLProgram: Shader Error "+n.getError()+" - VALIDATE_STATUS "+n.getProgramParameter(x,n.VALIDATE_STATUS)+`

Material Name: `+R.name+`
Material Type: `+R.type+`

Program Info Log: `+L+`
`+st+`
`+rt)}else L!==""?Nt("WebGLProgram: Program Info Log:",L):(N===""||D==="")&&(Q=!1);Q&&(R.diagnostics={runnable:$,programLog:L,vertexShader:{log:N,prefix:m},fragmentShader:{log:D,prefix:g}})}n.deleteShader(E),n.deleteShader(b),y=new Eo(n,x),w=w_(n,x)}let y;this.getUniforms=function(){return y===void 0&&A(this),y};let w;this.getAttributes=function(){return w===void 0&&A(this),w};let C=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return C===!1&&(C=n.getProgramParameter(x,p_)),C},this.destroy=function(){i.releaseStatesOfProgram(this),n.deleteProgram(x),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=m_++,this.cacheKey=t,this.usedTimes=1,this.program=x,this.vertexShader=E,this.fragmentShader=b,this}let B_=0;class V_{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,e,i){const n=this._getShaderCacheForMaterial(t);return n.has(e)===!1&&(n.add(e),e.usedTimes++),n.has(i)===!1&&(n.add(i),i.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const i of e)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let i=e.get(t);return i===void 0&&(i=new Set,e.set(t,i)),i}_getShaderStage(t){const e=this.shaderCache;let i=e.get(t);return i===void 0&&(i=new G_(t),e.set(t,i)),i}}class G_{constructor(t){this.id=B_++,this.code=t,this.usedTimes=0}}function H_(r){return r===rs||r===Po||r===Io}function W_(r,t,e,i,n,s){const a=new bc,o=new V_,l=new Set,h=[],c=new Map,d=i.logarithmicDepthBuffer;let u=i.precision;const f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function p(y){return l.add(y),y===0?"uv":`uv${y}`}function x(y,w,C,R,I,z){const G=R.fog,L=I.geometry,N=y.isMeshStandardMaterial||y.isMeshLambertMaterial||y.isMeshPhongMaterial?R.environment:null,D=y.isMeshStandardMaterial||y.isMeshLambertMaterial&&!y.envMap||y.isMeshPhongMaterial&&!y.envMap,$=t.get(y.envMap||N,D),Q=$&&$.mapping===Go?$.image.height:null,st=f[y.type];y.precision!==null&&(u=i.getMaxPrecision(y.precision),u!==y.precision&&Nt("WebGLProgram.getParameters:",y.precision,"not supported, using",u,"instead."));const rt=L.morphAttributes.position||L.morphAttributes.normal||L.morphAttributes.color,U=rt!==void 0?rt.length:0;let at=0;L.morphAttributes.position!==void 0&&(at=1),L.morphAttributes.normal!==void 0&&(at=2),L.morphAttributes.color!==void 0&&(at=3);let bt,_t,X,nt;if(st){const wt=zi[st];bt=wt.vertexShader,_t=wt.fragmentShader}else{bt=y.vertexShader,_t=y.fragmentShader;const wt=o.getVertexShaderStage(y),_e=o.getFragmentShaderStage(y);o.update(y,wt,_e),X=wt.id,nt=_e.id}const et=r.getRenderTarget(),Rt=r.state.buffers.depth.getReversed(),Dt=I.isInstancedMesh===!0,yt=I.isBatchedMesh===!0,te=!!y.map,St=!!y.matcap,Ft=!!$,kt=!!y.aoMap,Ot=!!y.lightMap,se=!!y.bumpMap&&y.wireframe===!1,me=!!y.normalMap,xe=!!y.displacementMap,be=!!y.emissiveMap,ye=!!y.metalnessMap,Ae=!!y.roughnessMap,O=y.anisotropy>0,Qe=y.clearcoat>0,ee=y.dispersion>0,P=y.iridescence>0,M=y.sheen>0,V=y.transmission>0,q=O&&!!y.anisotropyMap,K=Qe&&!!y.clearcoatMap,ot=Qe&&!!y.clearcoatNormalMap,ht=Qe&&!!y.clearcoatRoughnessMap,J=P&&!!y.iridescenceMap,tt=P&&!!y.iridescenceThicknessMap,ct=M&&!!y.sheenColorMap,At=M&&!!y.sheenRoughnessMap,ft=!!y.specularMap,ut=!!y.specularColorMap,It=!!y.specularIntensityMap,Lt=V&&!!y.transmissionMap,Bt=V&&!!y.thicknessMap,F=!!y.gradientMap,lt=!!y.alphaMap,j=y.alphaTest>0,dt=!!y.alphaHash,xt=!!y.extensions;let it=Ai;y.toneMapped&&(et===null||et.isXRRenderTarget===!0)&&(it=r.toneMapping);const Tt={shaderID:st,shaderType:y.type,shaderName:y.name,vertexShader:bt,fragmentShader:_t,defines:y.defines,customVertexShaderID:X,customFragmentShaderID:nt,isRawShaderMaterial:y.isRawShaderMaterial===!0,glslVersion:y.glslVersion,precision:u,batching:yt,batchingColor:yt&&I._colorsTexture!==null,instancing:Dt,instancingColor:Dt&&I.instanceColor!==null,instancingMorph:Dt&&I.morphTexture!==null,outputColorSpace:et===null?r.outputColorSpace:et.isXRRenderTarget===!0?et.texture.colorSpace:Zt.workingColorSpace,alphaToCoverage:!!y.alphaToCoverage,map:te,matcap:St,envMap:Ft,envMapMode:Ft&&$.mapping,envMapCubeUVHeight:Q,aoMap:kt,lightMap:Ot,bumpMap:se,normalMap:me,displacementMap:xe,emissiveMap:be,normalMapObjectSpace:me&&y.normalMapType===hm,normalMapTangentSpace:me&&y.normalMapType===Do,packedNormalMap:me&&y.normalMapType===Do&&H_(y.normalMap.format),metalnessMap:ye,roughnessMap:Ae,anisotropy:O,anisotropyMap:q,clearcoat:Qe,clearcoatMap:K,clearcoatNormalMap:ot,clearcoatRoughnessMap:ht,dispersion:ee,iridescence:P,iridescenceMap:J,iridescenceThicknessMap:tt,sheen:M,sheenColorMap:ct,sheenRoughnessMap:At,specularMap:ft,specularColorMap:ut,specularIntensityMap:It,transmission:V,transmissionMap:Lt,thicknessMap:Bt,gradientMap:F,opaque:y.transparent===!1&&y.blending===rr&&y.alphaToCoverage===!1,alphaMap:lt,alphaTest:j,alphaHash:dt,combine:y.combine,mapUv:te&&p(y.map.channel),aoMapUv:kt&&p(y.aoMap.channel),lightMapUv:Ot&&p(y.lightMap.channel),bumpMapUv:se&&p(y.bumpMap.channel),normalMapUv:me&&p(y.normalMap.channel),displacementMapUv:xe&&p(y.displacementMap.channel),emissiveMapUv:be&&p(y.emissiveMap.channel),metalnessMapUv:ye&&p(y.metalnessMap.channel),roughnessMapUv:Ae&&p(y.roughnessMap.channel),anisotropyMapUv:q&&p(y.anisotropyMap.channel),clearcoatMapUv:K&&p(y.clearcoatMap.channel),clearcoatNormalMapUv:ot&&p(y.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ht&&p(y.clearcoatRoughnessMap.channel),iridescenceMapUv:J&&p(y.iridescenceMap.channel),iridescenceThicknessMapUv:tt&&p(y.iridescenceThicknessMap.channel),sheenColorMapUv:ct&&p(y.sheenColorMap.channel),sheenRoughnessMapUv:At&&p(y.sheenRoughnessMap.channel),specularMapUv:ft&&p(y.specularMap.channel),specularColorMapUv:ut&&p(y.specularColorMap.channel),specularIntensityMapUv:It&&p(y.specularIntensityMap.channel),transmissionMapUv:Lt&&p(y.transmissionMap.channel),thicknessMapUv:Bt&&p(y.thicknessMap.channel),alphaMapUv:lt&&p(y.alphaMap.channel),vertexTangents:!!L.attributes.tangent&&(me||O),vertexNormals:!!L.attributes.normal,vertexColors:y.vertexColors,vertexAlphas:y.vertexColors===!0&&!!L.attributes.color&&L.attributes.color.itemSize===4,pointsUvs:I.isPoints===!0&&!!L.attributes.uv&&(te||lt),fog:!!G,useFog:y.fog===!0,fogExp2:!!G&&G.isFogExp2,flatShading:y.wireframe===!1&&(y.flatShading===!0||L.attributes.normal===void 0&&me===!1&&(y.isMeshLambertMaterial||y.isMeshPhongMaterial||y.isMeshStandardMaterial||y.isMeshPhysicalMaterial)),sizeAttenuation:y.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:Rt,skinning:I.isSkinnedMesh===!0,hasPositionAttribute:L.attributes.position!==void 0,morphTargets:L.morphAttributes.position!==void 0,morphNormals:L.morphAttributes.normal!==void 0,morphColors:L.morphAttributes.color!==void 0,morphTargetsCount:U,morphTextureStride:at,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numLightProbeGrids:z.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:y.dithering,shadowMapEnabled:r.shadowMap.enabled&&C.length>0,shadowMapType:r.shadowMap.type,toneMapping:it,decodeVideoTexture:te&&y.map.isVideoTexture===!0&&Zt.getTransfer(y.map.colorSpace)===ie,decodeVideoTextureEmissive:be&&y.emissiveMap.isVideoTexture===!0&&Zt.getTransfer(y.emissiveMap.colorSpace)===ie,premultipliedAlpha:y.premultipliedAlpha,doubleSided:y.side===en,flipSided:y.side===Be,useDepthPacking:y.depthPacking>=0,depthPacking:y.depthPacking||0,index0AttributeName:y.index0AttributeName,extensionClipCullDistance:xt&&y.extensions.clipCullDistance===!0&&e.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(xt&&y.extensions.multiDraw===!0||yt)&&e.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:e.has("KHR_parallel_shader_compile"),customProgramCacheKey:y.customProgramCacheKey()};return Tt.vertexUv1s=l.has(1),Tt.vertexUv2s=l.has(2),Tt.vertexUv3s=l.has(3),l.clear(),Tt}function m(y){const w=[];if(y.shaderID?w.push(y.shaderID):(w.push(y.customVertexShaderID),w.push(y.customFragmentShaderID)),y.defines!==void 0)for(const C in y.defines)w.push(C),w.push(y.defines[C]);return y.isRawShaderMaterial===!1&&(g(w,y),v(w,y),w.push(r.outputColorSpace)),w.push(y.customProgramCacheKey),w.join()}function g(y,w){y.push(w.precision),y.push(w.outputColorSpace),y.push(w.envMapMode),y.push(w.envMapCubeUVHeight),y.push(w.mapUv),y.push(w.alphaMapUv),y.push(w.lightMapUv),y.push(w.aoMapUv),y.push(w.bumpMapUv),y.push(w.normalMapUv),y.push(w.displacementMapUv),y.push(w.emissiveMapUv),y.push(w.metalnessMapUv),y.push(w.roughnessMapUv),y.push(w.anisotropyMapUv),y.push(w.clearcoatMapUv),y.push(w.clearcoatNormalMapUv),y.push(w.clearcoatRoughnessMapUv),y.push(w.iridescenceMapUv),y.push(w.iridescenceThicknessMapUv),y.push(w.sheenColorMapUv),y.push(w.sheenRoughnessMapUv),y.push(w.specularMapUv),y.push(w.specularColorMapUv),y.push(w.specularIntensityMapUv),y.push(w.transmissionMapUv),y.push(w.thicknessMapUv),y.push(w.combine),y.push(w.fogExp2),y.push(w.sizeAttenuation),y.push(w.morphTargetsCount),y.push(w.morphAttributeCount),y.push(w.numDirLights),y.push(w.numPointLights),y.push(w.numSpotLights),y.push(w.numSpotLightMaps),y.push(w.numHemiLights),y.push(w.numRectAreaLights),y.push(w.numDirLightShadows),y.push(w.numPointLightShadows),y.push(w.numSpotLightShadows),y.push(w.numSpotLightShadowsWithMaps),y.push(w.numLightProbes),y.push(w.shadowMapType),y.push(w.toneMapping),y.push(w.numClippingPlanes),y.push(w.numClipIntersection),y.push(w.depthPacking)}function v(y,w){a.disableAll(),w.instancing&&a.enable(0),w.instancingColor&&a.enable(1),w.instancingMorph&&a.enable(2),w.matcap&&a.enable(3),w.envMap&&a.enable(4),w.normalMapObjectSpace&&a.enable(5),w.normalMapTangentSpace&&a.enable(6),w.clearcoat&&a.enable(7),w.iridescence&&a.enable(8),w.alphaTest&&a.enable(9),w.vertexColors&&a.enable(10),w.vertexAlphas&&a.enable(11),w.vertexUv1s&&a.enable(12),w.vertexUv2s&&a.enable(13),w.vertexUv3s&&a.enable(14),w.vertexTangents&&a.enable(15),w.anisotropy&&a.enable(16),w.alphaHash&&a.enable(17),w.batching&&a.enable(18),w.dispersion&&a.enable(19),w.batchingColor&&a.enable(20),w.gradientMap&&a.enable(21),w.packedNormalMap&&a.enable(22),w.vertexNormals&&a.enable(23),y.push(a.mask),a.disableAll(),w.fog&&a.enable(0),w.useFog&&a.enable(1),w.flatShading&&a.enable(2),w.logarithmicDepthBuffer&&a.enable(3),w.reversedDepthBuffer&&a.enable(4),w.skinning&&a.enable(5),w.morphTargets&&a.enable(6),w.morphNormals&&a.enable(7),w.morphColors&&a.enable(8),w.premultipliedAlpha&&a.enable(9),w.shadowMapEnabled&&a.enable(10),w.doubleSided&&a.enable(11),w.flipSided&&a.enable(12),w.useDepthPacking&&a.enable(13),w.dithering&&a.enable(14),w.transmission&&a.enable(15),w.sheen&&a.enable(16),w.opaque&&a.enable(17),w.pointsUvs&&a.enable(18),w.decodeVideoTexture&&a.enable(19),w.decodeVideoTextureEmissive&&a.enable(20),w.alphaToCoverage&&a.enable(21),w.numLightProbeGrids>0&&a.enable(22),w.hasPositionAttribute&&a.enable(23),y.push(a.mask)}function S(y){const w=f[y.type];let C;if(w){const R=zi[w];C=Yf.clone(R.uniforms)}else C=y.uniforms;return C}function _(y,w){let C=c.get(w);return C!==void 0?++C.usedTimes:(C=new k_(r,w,y,n),h.push(C),c.set(w,C)),C}function E(y){if(--y.usedTimes===0){const w=h.indexOf(y);h[w]=h[h.length-1],h.pop(),c.delete(y.cacheKey),y.destroy()}}function b(y){o.remove(y)}function A(){o.dispose()}return{getParameters:x,getProgramCacheKey:m,getUniforms:S,acquireProgram:_,releaseProgram:E,releaseShaderCache:b,programs:h,dispose:A}}function X_(){let r=new WeakMap;function t(a){return r.has(a)}function e(a){let o=r.get(a);return o===void 0&&(o={},r.set(a,o)),o}function i(a){r.delete(a)}function n(a,o,l){r.get(a)[o]=l}function s(){r=new WeakMap}return{has:t,get:e,remove:i,update:n,dispose:s}}function q_(r,t){return r.groupOrder!==t.groupOrder?r.groupOrder-t.groupOrder:r.renderOrder!==t.renderOrder?r.renderOrder-t.renderOrder:r.material.id!==t.material.id?r.material.id-t.material.id:r.materialVariant!==t.materialVariant?r.materialVariant-t.materialVariant:r.z!==t.z?r.z-t.z:r.id-t.id}function $u(r,t){return r.groupOrder!==t.groupOrder?r.groupOrder-t.groupOrder:r.renderOrder!==t.renderOrder?r.renderOrder-t.renderOrder:r.z!==t.z?t.z-r.z:r.id-t.id}function Yu(){const r=[];let t=0;const e=[],i=[],n=[];function s(){t=0,e.length=0,i.length=0,n.length=0}function a(u){let f=0;return u.isInstancedMesh&&(f+=2),u.isSkinnedMesh&&(f+=1),f}function o(u,f,p,x,m,g){let v=r[t];return v===void 0?(v={id:u.id,object:u,geometry:f,material:p,materialVariant:a(u),groupOrder:x,renderOrder:u.renderOrder,z:m,group:g},r[t]=v):(v.id=u.id,v.object=u,v.geometry=f,v.material=p,v.materialVariant=a(u),v.groupOrder=x,v.renderOrder=u.renderOrder,v.z=m,v.group=g),t++,v}function l(u,f,p,x,m,g){const v=o(u,f,p,x,m,g);p.transmission>0?i.push(v):p.transparent===!0?n.push(v):e.push(v)}function h(u,f,p,x,m,g){const v=o(u,f,p,x,m,g);p.transmission>0?i.unshift(v):p.transparent===!0?n.unshift(v):e.unshift(v)}function c(u,f,p){e.length>1&&e.sort(u||q_),i.length>1&&i.sort(f||$u),n.length>1&&n.sort(f||$u),p&&(e.reverse(),i.reverse(),n.reverse())}function d(){for(let u=t,f=r.length;u<f;u++){const p=r[u];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:i,transparent:n,init:s,push:l,unshift:h,finish:d,sort:c}}function $_(){let r=new WeakMap;function t(i,n){const s=r.get(i);let a;return s===void 0?(a=new Yu,r.set(i,[a])):n>=s.length?(a=new Yu,s.push(a)):a=s[n],a}function e(){r=new WeakMap}return{get:t,dispose:e}}function Y_(){const r={};return{get:function(t){if(r[t.id]!==void 0)return r[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new B,color:new zt};break;case"SpotLight":e={position:new B,direction:new B,color:new zt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new B,color:new zt,distance:0,decay:0};break;case"HemisphereLight":e={direction:new B,skyColor:new zt,groundColor:new zt};break;case"RectAreaLight":e={color:new zt,position:new B,halfWidth:new B,halfHeight:new B};break}return r[t.id]=e,e}}}function Z_(){const r={};return{get:function(t){if(r[t.id]!==void 0)return r[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut,shadowCameraNear:1,shadowCameraFar:1e3};break}return r[t.id]=e,e}}}let K_=0;function J_(r,t){return(t.castShadow?2:0)-(r.castShadow?2:0)+(t.map?1:0)-(r.map?1:0)}function Q_(r){const t=new Y_,e=Z_(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)i.probe.push(new B);const n=new B,s=new pe,a=new pe;function o(h){let c=0,d=0,u=0;for(let w=0;w<9;w++)i.probe[w].set(0,0,0);let f=0,p=0,x=0,m=0,g=0,v=0,S=0,_=0,E=0,b=0,A=0;h.sort(J_);for(let w=0,C=h.length;w<C;w++){const R=h[w],I=R.color,z=R.intensity,G=R.distance;let L=null;if(R.shadow&&R.shadow.map&&(R.shadow.map.texture.format===rs?L=R.shadow.map.texture:L=R.shadow.map.depthTexture||R.shadow.map.texture),R.isAmbientLight)c+=I.r*z,d+=I.g*z,u+=I.b*z;else if(R.isLightProbe){for(let N=0;N<9;N++)i.probe[N].addScaledVector(R.sh.coefficients[N],z);A++}else if(R.isDirectionalLight){const N=t.get(R);if(N.color.copy(R.color).multiplyScalar(R.intensity),R.castShadow){const D=R.shadow,$=e.get(R);$.shadowIntensity=D.intensity,$.shadowBias=D.bias,$.shadowNormalBias=D.normalBias,$.shadowRadius=D.radius,$.shadowMapSize=D.mapSize,i.directionalShadow[f]=$,i.directionalShadowMap[f]=L,i.directionalShadowMatrix[f]=R.shadow.matrix,v++}i.directional[f]=N,f++}else if(R.isSpotLight){const N=t.get(R);N.position.setFromMatrixPosition(R.matrixWorld),N.color.copy(I).multiplyScalar(z),N.distance=G,N.coneCos=Math.cos(R.angle),N.penumbraCos=Math.cos(R.angle*(1-R.penumbra)),N.decay=R.decay,i.spot[x]=N;const D=R.shadow;if(R.map&&(i.spotLightMap[E]=R.map,E++,D.updateMatrices(R),R.castShadow&&b++),i.spotLightMatrix[x]=D.matrix,R.castShadow){const $=e.get(R);$.shadowIntensity=D.intensity,$.shadowBias=D.bias,$.shadowNormalBias=D.normalBias,$.shadowRadius=D.radius,$.shadowMapSize=D.mapSize,i.spotShadow[x]=$,i.spotShadowMap[x]=L,_++}x++}else if(R.isRectAreaLight){const N=t.get(R);N.color.copy(I).multiplyScalar(z),N.halfWidth.set(R.width*.5,0,0),N.halfHeight.set(0,R.height*.5,0),i.rectArea[m]=N,m++}else if(R.isPointLight){const N=t.get(R);if(N.color.copy(R.color).multiplyScalar(R.intensity),N.distance=R.distance,N.decay=R.decay,R.castShadow){const D=R.shadow,$=e.get(R);$.shadowIntensity=D.intensity,$.shadowBias=D.bias,$.shadowNormalBias=D.normalBias,$.shadowRadius=D.radius,$.shadowMapSize=D.mapSize,$.shadowCameraNear=D.camera.near,$.shadowCameraFar=D.camera.far,i.pointShadow[p]=$,i.pointShadowMap[p]=L,i.pointShadowMatrix[p]=R.shadow.matrix,S++}i.point[p]=N,p++}else if(R.isHemisphereLight){const N=t.get(R);N.skyColor.copy(R.color).multiplyScalar(z),N.groundColor.copy(R.groundColor).multiplyScalar(z),i.hemi[g]=N,g++}}m>0&&(r.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=pt.LTC_FLOAT_1,i.rectAreaLTC2=pt.LTC_FLOAT_2):(i.rectAreaLTC1=pt.LTC_HALF_1,i.rectAreaLTC2=pt.LTC_HALF_2)),i.ambient[0]=c,i.ambient[1]=d,i.ambient[2]=u;const y=i.hash;(y.directionalLength!==f||y.pointLength!==p||y.spotLength!==x||y.rectAreaLength!==m||y.hemiLength!==g||y.numDirectionalShadows!==v||y.numPointShadows!==S||y.numSpotShadows!==_||y.numSpotMaps!==E||y.numLightProbes!==A)&&(i.directional.length=f,i.spot.length=x,i.rectArea.length=m,i.point.length=p,i.hemi.length=g,i.directionalShadow.length=v,i.directionalShadowMap.length=v,i.pointShadow.length=S,i.pointShadowMap.length=S,i.spotShadow.length=_,i.spotShadowMap.length=_,i.directionalShadowMatrix.length=v,i.pointShadowMatrix.length=S,i.spotLightMatrix.length=_+E-b,i.spotLightMap.length=E,i.numSpotLightShadowsWithMaps=b,i.numLightProbes=A,y.directionalLength=f,y.pointLength=p,y.spotLength=x,y.rectAreaLength=m,y.hemiLength=g,y.numDirectionalShadows=v,y.numPointShadows=S,y.numSpotShadows=_,y.numSpotMaps=E,y.numLightProbes=A,i.version=K_++)}function l(h,c){let d=0,u=0,f=0,p=0,x=0;const m=c.matrixWorldInverse;for(let g=0,v=h.length;g<v;g++){const S=h[g];if(S.isDirectionalLight){const _=i.directional[d];_.direction.setFromMatrixPosition(S.matrixWorld),n.setFromMatrixPosition(S.target.matrixWorld),_.direction.sub(n),_.direction.transformDirection(m),d++}else if(S.isSpotLight){const _=i.spot[f];_.position.setFromMatrixPosition(S.matrixWorld),_.position.applyMatrix4(m),_.direction.setFromMatrixPosition(S.matrixWorld),n.setFromMatrixPosition(S.target.matrixWorld),_.direction.sub(n),_.direction.transformDirection(m),f++}else if(S.isRectAreaLight){const _=i.rectArea[p];_.position.setFromMatrixPosition(S.matrixWorld),_.position.applyMatrix4(m),a.identity(),s.copy(S.matrixWorld),s.premultiply(m),a.extractRotation(s),_.halfWidth.set(S.width*.5,0,0),_.halfHeight.set(0,S.height*.5,0),_.halfWidth.applyMatrix4(a),_.halfHeight.applyMatrix4(a),p++}else if(S.isPointLight){const _=i.point[u];_.position.setFromMatrixPosition(S.matrixWorld),_.position.applyMatrix4(m),u++}else if(S.isHemisphereLight){const _=i.hemi[x];_.direction.setFromMatrixPosition(S.matrixWorld),_.direction.transformDirection(m),x++}}}return{setup:o,setupView:l,state:i}}function Zu(r){const t=new Q_(r),e=[],i=[],n=[];function s(u){d.camera=u,e.length=0,i.length=0,n.length=0}function a(u){e.push(u)}function o(u){i.push(u)}function l(u){n.push(u)}function h(){t.setup(e)}function c(u){t.setupView(e,u)}const d={lightsArray:e,shadowsArray:i,lightProbeGridArray:n,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:d,setupLights:h,setupLightsView:c,pushLight:a,pushShadow:o,pushLightProbeGrid:l}}function j_(r){let t=new WeakMap;function e(n,s=0){const a=t.get(n);let o;return a===void 0?(o=new Zu(r),t.set(n,[o])):s>=a.length?(o=new Zu(r),a.push(o)):o=a[s],o}function i(){t=new WeakMap}return{get:e,dispose:i}}const tv=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,ev=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,iv=[new B(1,0,0),new B(-1,0,0),new B(0,1,0),new B(0,-1,0),new B(0,0,1),new B(0,0,-1)],nv=[new B(0,-1,0),new B(0,-1,0),new B(0,0,1),new B(0,0,-1),new B(0,-1,0),new B(0,-1,0)],Ku=new pe,Dr=new B,wl=new B;function sv(r,t,e){let i=new Tc;const n=new Ut,s=new Ut,a=new Te,o=new d0,l=new f0,h={},c=e.maxTextureSize,d={[Fn]:Be,[Be]:Fn,[en]:en},u=new xi({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ut},radius:{value:4}},vertexShader:tv,fragmentShader:ev}),f=u.clone();f.defines.HORIZONTAL_PASS=1;const p=new Vn;p.setAttribute("position",new Ci(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const x=new Pe(p,u),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=xo;let g=this.type;this.render=function(b,A,y){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||b.length===0)return;this.type===vf&&(Nt("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=xo);const w=r.getRenderTarget(),C=r.getActiveCubeFace(),R=r.getActiveMipmapLevel(),I=r.state;I.setBlending(sn),I.buffers.depth.getReversed()===!0?I.buffers.color.setClear(0,0,0,0):I.buffers.color.setClear(1,1,1,1),I.buffers.depth.setTest(!0),I.setScissorTest(!1);const z=g!==this.type;z&&A.traverse(function(G){G.material&&(Array.isArray(G.material)?G.material.forEach(L=>L.needsUpdate=!0):G.material.needsUpdate=!0)});for(let G=0,L=b.length;G<L;G++){const N=b[G],D=N.shadow;if(D===void 0){Nt("WebGLShadowMap:",N,"has no shadow.");continue}if(D.autoUpdate===!1&&D.needsUpdate===!1)continue;n.copy(D.mapSize);const $=D.getFrameExtents();n.multiply($),s.copy(D.mapSize),(n.x>c||n.y>c)&&(n.x>c&&(s.x=Math.floor(c/$.x),n.x=s.x*$.x,D.mapSize.x=s.x),n.y>c&&(s.y=Math.floor(c/$.y),n.y=s.y*$.y,D.mapSize.y=s.y));const Q=r.state.buffers.depth.getReversed();if(D.camera._reversedDepth=Q,D.map===null||z===!0){if(D.map!==null&&(D.map.depthTexture!==null&&(D.map.depthTexture.dispose(),D.map.depthTexture=null),D.map.dispose()),this.type===qr){if(N.isPointLight){Nt("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}D.map=new Bi(n.x,n.y,{format:rs,type:on,minFilter:qe,magFilter:qe,generateMipmaps:!1}),D.map.texture.name=N.name+".shadowMap",D.map.depthTexture=new pr(n.x,n.y,Ei),D.map.depthTexture.name=N.name+".shadowMapDepth",D.map.depthTexture.format=ln,D.map.depthTexture.compareFunction=null,D.map.depthTexture.minFilter=Oe,D.map.depthTexture.magFilter=Oe}else N.isPointLight?(D.map=new tp(n.x),D.map.depthTexture=new r0(n.x,Gi)):(D.map=new Bi(n.x,n.y),D.map.depthTexture=new pr(n.x,n.y,Gi)),D.map.depthTexture.name=N.name+".shadowMap",D.map.depthTexture.format=ln,this.type===xo?(D.map.depthTexture.compareFunction=Q?_c:yc,D.map.depthTexture.minFilter=qe,D.map.depthTexture.magFilter=qe):(D.map.depthTexture.compareFunction=null,D.map.depthTexture.minFilter=Oe,D.map.depthTexture.magFilter=Oe);D.camera.updateProjectionMatrix()}const st=D.map.isWebGLCubeRenderTarget?6:1;for(let rt=0;rt<st;rt++){if(D.map.isWebGLCubeRenderTarget)r.setRenderTarget(D.map,rt),r.clear();else{rt===0&&(r.setRenderTarget(D.map),r.clear());const U=D.getViewport(rt);a.set(s.x*U.x,s.y*U.y,s.x*U.z,s.y*U.w),I.viewport(a)}if(N.isPointLight){const U=D.camera,at=D.matrix,bt=N.distance||U.far;bt!==U.far&&(U.far=bt,U.updateProjectionMatrix()),Dr.setFromMatrixPosition(N.matrixWorld),U.position.copy(Dr),wl.copy(U.position),wl.add(iv[rt]),U.up.copy(nv[rt]),U.lookAt(wl),U.updateMatrixWorld(),at.makeTranslation(-Dr.x,-Dr.y,-Dr.z),Ku.multiplyMatrices(U.projectionMatrix,U.matrixWorldInverse),D._frustum.setFromProjectionMatrix(Ku,U.coordinateSystem,U.reversedDepth)}else D.updateMatrices(N);i=D.getFrustum(),_(A,y,D.camera,N,this.type)}D.isPointLightShadow!==!0&&this.type===qr&&v(D,y),D.needsUpdate=!1}g=this.type,m.needsUpdate=!1,r.setRenderTarget(w,C,R)};function v(b,A){const y=t.update(x);u.defines.VSM_SAMPLES!==b.blurSamples&&(u.defines.VSM_SAMPLES=b.blurSamples,f.defines.VSM_SAMPLES=b.blurSamples,u.needsUpdate=!0,f.needsUpdate=!0),b.mapPass===null&&(b.mapPass=new Bi(n.x,n.y,{format:rs,type:on})),u.uniforms.shadow_pass.value=b.map.depthTexture,u.uniforms.resolution.value=b.mapSize,u.uniforms.radius.value=b.radius,r.setRenderTarget(b.mapPass),r.clear(),r.renderBufferDirect(A,null,y,u,x,null),f.uniforms.shadow_pass.value=b.mapPass.texture,f.uniforms.resolution.value=b.mapSize,f.uniforms.radius.value=b.radius,r.setRenderTarget(b.map),r.clear(),r.renderBufferDirect(A,null,y,f,x,null)}function S(b,A,y,w){let C=null;const R=y.isPointLight===!0?b.customDistanceMaterial:b.customDepthMaterial;if(R!==void 0)C=R;else if(C=y.isPointLight===!0?l:o,r.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0||A.alphaToCoverage===!0){const I=C.uuid,z=A.uuid;let G=h[I];G===void 0&&(G={},h[I]=G);let L=G[z];L===void 0&&(L=C.clone(),G[z]=L,A.addEventListener("dispose",E)),C=L}if(C.visible=A.visible,C.wireframe=A.wireframe,w===qr?C.side=A.shadowSide!==null?A.shadowSide:A.side:C.side=A.shadowSide!==null?A.shadowSide:d[A.side],C.alphaMap=A.alphaMap,C.alphaTest=A.alphaToCoverage===!0?.5:A.alphaTest,C.map=A.map,C.clipShadows=A.clipShadows,C.clippingPlanes=A.clippingPlanes,C.clipIntersection=A.clipIntersection,C.displacementMap=A.displacementMap,C.displacementScale=A.displacementScale,C.displacementBias=A.displacementBias,C.wireframeLinewidth=A.wireframeLinewidth,C.linewidth=A.linewidth,y.isPointLight===!0&&C.isMeshDistanceMaterial===!0){const I=r.properties.get(C);I.light=y}return C}function _(b,A,y,w,C){if(b.visible===!1)return;if(b.layers.test(A.layers)&&(b.isMesh||b.isLine||b.isPoints)&&(b.castShadow||b.receiveShadow&&C===qr)&&(!b.frustumCulled||i.intersectsObject(b))){b.modelViewMatrix.multiplyMatrices(y.matrixWorldInverse,b.matrixWorld);const z=t.update(b),G=b.material;if(Array.isArray(G)){const L=z.groups;for(let N=0,D=L.length;N<D;N++){const $=L[N],Q=G[$.materialIndex];if(Q&&Q.visible){const st=S(b,Q,w,C);b.onBeforeShadow(r,b,A,y,z,st,$),r.renderBufferDirect(y,null,z,st,b,$),b.onAfterShadow(r,b,A,y,z,st,$)}}}else if(G.visible){const L=S(b,G,w,C);b.onBeforeShadow(r,b,A,y,z,L,null),r.renderBufferDirect(y,null,z,L,b,null),b.onAfterShadow(r,b,A,y,z,L,null)}}const I=b.children;for(let z=0,G=I.length;z<G;z++)_(I[z],A,y,w,C)}function E(b){b.target.removeEventListener("dispose",E);for(const y in h){const w=h[y],C=b.target.uuid;C in w&&(w[C].dispose(),delete w[C])}}}function rv(r,t){function e(){let F=!1;const lt=new Te;let j=null;const dt=new Te(0,0,0,0);return{setMask:function(xt){j!==xt&&!F&&(r.colorMask(xt,xt,xt,xt),j=xt)},setLocked:function(xt){F=xt},setClear:function(xt,it,Tt,wt,_e){_e===!0&&(xt*=wt,it*=wt,Tt*=wt),lt.set(xt,it,Tt,wt),dt.equals(lt)===!1&&(r.clearColor(xt,it,Tt,wt),dt.copy(lt))},reset:function(){F=!1,j=null,dt.set(-1,0,0,0)}}}function i(){let F=!1,lt=!1,j=null,dt=null,xt=null;return{setReversed:function(it){if(lt!==it){const Tt=t.get("EXT_clip_control");it?Tt.clipControlEXT(Tt.LOWER_LEFT_EXT,Tt.ZERO_TO_ONE_EXT):Tt.clipControlEXT(Tt.LOWER_LEFT_EXT,Tt.NEGATIVE_ONE_TO_ONE_EXT),lt=it;const wt=xt;xt=null,this.setClear(wt)}},getReversed:function(){return lt},setTest:function(it){it?et(r.DEPTH_TEST):Rt(r.DEPTH_TEST)},setMask:function(it){j!==it&&!F&&(r.depthMask(it),j=it)},setFunc:function(it){if(lt&&(it=_m[it]),dt!==it){switch(it){case hh:r.depthFunc(r.NEVER);break;case ch:r.depthFunc(r.ALWAYS);break;case uh:r.depthFunc(r.LESS);break;case dr:r.depthFunc(r.LEQUAL);break;case dh:r.depthFunc(r.EQUAL);break;case fh:r.depthFunc(r.GEQUAL);break;case ph:r.depthFunc(r.GREATER);break;case mh:r.depthFunc(r.NOTEQUAL);break;default:r.depthFunc(r.LEQUAL)}dt=it}},setLocked:function(it){F=it},setClear:function(it){xt!==it&&(xt=it,lt&&(it=1-it),r.clearDepth(it))},reset:function(){F=!1,j=null,dt=null,xt=null,lt=!1}}}function n(){let F=!1,lt=null,j=null,dt=null,xt=null,it=null,Tt=null,wt=null,_e=null;return{setTest:function(ce){F||(ce?et(r.STENCIL_TEST):Rt(r.STENCIL_TEST))},setMask:function(ce){lt!==ce&&!F&&(r.stencilMask(ce),lt=ce)},setFunc:function(ce,Ii,Di){(j!==ce||dt!==Ii||xt!==Di)&&(r.stencilFunc(ce,Ii,Di),j=ce,dt=Ii,xt=Di)},setOp:function(ce,Ii,Di){(it!==ce||Tt!==Ii||wt!==Di)&&(r.stencilOp(ce,Ii,Di),it=ce,Tt=Ii,wt=Di)},setLocked:function(ce){F=ce},setClear:function(ce){_e!==ce&&(r.clearStencil(ce),_e=ce)},reset:function(){F=!1,lt=null,j=null,dt=null,xt=null,it=null,Tt=null,wt=null,_e=null}}}const s=new e,a=new i,o=new n,l=new WeakMap,h=new WeakMap;let c={},d={},u={},f=new WeakMap,p=[],x=null,m=!1,g=null,v=null,S=null,_=null,E=null,b=null,A=null,y=new zt(0,0,0),w=0,C=!1,R=null,I=null,z=null,G=null,L=null;const N=r.getParameter(r.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let D=!1,$=0;const Q=r.getParameter(r.VERSION);Q.indexOf("WebGL")!==-1?($=parseFloat(/^WebGL (\d)/.exec(Q)[1]),D=$>=1):Q.indexOf("OpenGL ES")!==-1&&($=parseFloat(/^OpenGL ES (\d)/.exec(Q)[1]),D=$>=2);let st=null,rt={};const U=r.getParameter(r.SCISSOR_BOX),at=r.getParameter(r.VIEWPORT),bt=new Te().fromArray(U),_t=new Te().fromArray(at);function X(F,lt,j,dt){const xt=new Uint8Array(4),it=r.createTexture();r.bindTexture(F,it),r.texParameteri(F,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(F,r.TEXTURE_MAG_FILTER,r.NEAREST);for(let Tt=0;Tt<j;Tt++)F===r.TEXTURE_3D||F===r.TEXTURE_2D_ARRAY?r.texImage3D(lt,0,r.RGBA,1,1,dt,0,r.RGBA,r.UNSIGNED_BYTE,xt):r.texImage2D(lt+Tt,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,xt);return it}const nt={};nt[r.TEXTURE_2D]=X(r.TEXTURE_2D,r.TEXTURE_2D,1),nt[r.TEXTURE_CUBE_MAP]=X(r.TEXTURE_CUBE_MAP,r.TEXTURE_CUBE_MAP_POSITIVE_X,6),nt[r.TEXTURE_2D_ARRAY]=X(r.TEXTURE_2D_ARRAY,r.TEXTURE_2D_ARRAY,1,1),nt[r.TEXTURE_3D]=X(r.TEXTURE_3D,r.TEXTURE_3D,1,1),s.setClear(0,0,0,1),a.setClear(1),o.setClear(0),et(r.DEPTH_TEST),a.setFunc(dr),se(!1),me(qc),et(r.CULL_FACE),kt(sn);function et(F){c[F]!==!0&&(r.enable(F),c[F]=!0)}function Rt(F){c[F]!==!1&&(r.disable(F),c[F]=!1)}function Dt(F,lt){return u[F]!==lt?(r.bindFramebuffer(F,lt),u[F]=lt,F===r.DRAW_FRAMEBUFFER&&(u[r.FRAMEBUFFER]=lt),F===r.FRAMEBUFFER&&(u[r.DRAW_FRAMEBUFFER]=lt),!0):!1}function yt(F,lt){let j=p,dt=!1;if(F){j=f.get(lt),j===void 0&&(j=[],f.set(lt,j));const xt=F.textures;if(j.length!==xt.length||j[0]!==r.COLOR_ATTACHMENT0){for(let it=0,Tt=xt.length;it<Tt;it++)j[it]=r.COLOR_ATTACHMENT0+it;j.length=xt.length,dt=!0}}else j[0]!==r.BACK&&(j[0]=r.BACK,dt=!0);dt&&r.drawBuffers(j)}function te(F){return x!==F?(r.useProgram(F),x=F,!0):!1}const St={[ts]:r.FUNC_ADD,[Gp]:r.FUNC_SUBTRACT,[Hp]:r.FUNC_REVERSE_SUBTRACT};St[Wp]=r.MIN,St[Xp]=r.MAX;const Ft={[qp]:r.ZERO,[$p]:r.ONE,[Yp]:r.SRC_COLOR,[oh]:r.SRC_ALPHA,[tm]:r.SRC_ALPHA_SATURATE,[Qp]:r.DST_COLOR,[Kp]:r.DST_ALPHA,[Zp]:r.ONE_MINUS_SRC_COLOR,[lh]:r.ONE_MINUS_SRC_ALPHA,[jp]:r.ONE_MINUS_DST_COLOR,[Jp]:r.ONE_MINUS_DST_ALPHA,[em]:r.CONSTANT_COLOR,[im]:r.ONE_MINUS_CONSTANT_COLOR,[nm]:r.CONSTANT_ALPHA,[sm]:r.ONE_MINUS_CONSTANT_ALPHA};function kt(F,lt,j,dt,xt,it,Tt,wt,_e,ce){if(F===sn){m===!0&&(Rt(r.BLEND),m=!1);return}if(m===!1&&(et(r.BLEND),m=!0),F!==Vp){if(F!==g||ce!==C){if((v!==ts||E!==ts)&&(r.blendEquation(r.FUNC_ADD),v=ts,E=ts),ce)switch(F){case rr:r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case $c:r.blendFunc(r.ONE,r.ONE);break;case Yc:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case Zc:r.blendFuncSeparate(r.DST_COLOR,r.ONE_MINUS_SRC_ALPHA,r.ZERO,r.ONE);break;default:Qt("WebGLState: Invalid blending: ",F);break}else switch(F){case rr:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case $c:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE,r.ONE,r.ONE);break;case Yc:Qt("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Zc:Qt("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Qt("WebGLState: Invalid blending: ",F);break}S=null,_=null,b=null,A=null,y.set(0,0,0),w=0,g=F,C=ce}return}xt=xt||lt,it=it||j,Tt=Tt||dt,(lt!==v||xt!==E)&&(r.blendEquationSeparate(St[lt],St[xt]),v=lt,E=xt),(j!==S||dt!==_||it!==b||Tt!==A)&&(r.blendFuncSeparate(Ft[j],Ft[dt],Ft[it],Ft[Tt]),S=j,_=dt,b=it,A=Tt),(wt.equals(y)===!1||_e!==w)&&(r.blendColor(wt.r,wt.g,wt.b,_e),y.copy(wt),w=_e),g=F,C=!1}function Ot(F,lt){F.side===en?Rt(r.CULL_FACE):et(r.CULL_FACE);let j=F.side===Be;lt&&(j=!j),se(j),F.blending===rr&&F.transparent===!1?kt(sn):kt(F.blending,F.blendEquation,F.blendSrc,F.blendDst,F.blendEquationAlpha,F.blendSrcAlpha,F.blendDstAlpha,F.blendColor,F.blendAlpha,F.premultipliedAlpha),a.setFunc(F.depthFunc),a.setTest(F.depthTest),a.setMask(F.depthWrite),s.setMask(F.colorWrite);const dt=F.stencilWrite;o.setTest(dt),dt&&(o.setMask(F.stencilWriteMask),o.setFunc(F.stencilFunc,F.stencilRef,F.stencilFuncMask),o.setOp(F.stencilFail,F.stencilZFail,F.stencilZPass)),be(F.polygonOffset,F.polygonOffsetFactor,F.polygonOffsetUnits),F.alphaToCoverage===!0?et(r.SAMPLE_ALPHA_TO_COVERAGE):Rt(r.SAMPLE_ALPHA_TO_COVERAGE)}function se(F){R!==F&&(F?r.frontFace(r.CW):r.frontFace(r.CCW),R=F)}function me(F){F!==kp?(et(r.CULL_FACE),F!==I&&(F===qc?r.cullFace(r.BACK):F===Bp?r.cullFace(r.FRONT):r.cullFace(r.FRONT_AND_BACK))):Rt(r.CULL_FACE),I=F}function xe(F){F!==z&&(D&&r.lineWidth(F),z=F)}function be(F,lt,j){F?(et(r.POLYGON_OFFSET_FILL),(G!==lt||L!==j)&&(G=lt,L=j,a.getReversed()&&(lt=-lt),r.polygonOffset(lt,j))):Rt(r.POLYGON_OFFSET_FILL)}function ye(F){F?et(r.SCISSOR_TEST):Rt(r.SCISSOR_TEST)}function Ae(F){F===void 0&&(F=r.TEXTURE0+N-1),st!==F&&(r.activeTexture(F),st=F)}function O(F,lt,j){j===void 0&&(st===null?j=r.TEXTURE0+N-1:j=st);let dt=rt[j];dt===void 0&&(dt={type:void 0,texture:void 0},rt[j]=dt),(dt.type!==F||dt.texture!==lt)&&(st!==j&&(r.activeTexture(j),st=j),r.bindTexture(F,lt||nt[F]),dt.type=F,dt.texture=lt)}function Qe(){const F=rt[st];F!==void 0&&F.type!==void 0&&(r.bindTexture(F.type,null),F.type=void 0,F.texture=void 0)}function ee(){try{r.compressedTexImage2D(...arguments)}catch(F){Qt("WebGLState:",F)}}function P(){try{r.compressedTexImage3D(...arguments)}catch(F){Qt("WebGLState:",F)}}function M(){try{r.texSubImage2D(...arguments)}catch(F){Qt("WebGLState:",F)}}function V(){try{r.texSubImage3D(...arguments)}catch(F){Qt("WebGLState:",F)}}function q(){try{r.compressedTexSubImage2D(...arguments)}catch(F){Qt("WebGLState:",F)}}function K(){try{r.compressedTexSubImage3D(...arguments)}catch(F){Qt("WebGLState:",F)}}function ot(){try{r.texStorage2D(...arguments)}catch(F){Qt("WebGLState:",F)}}function ht(){try{r.texStorage3D(...arguments)}catch(F){Qt("WebGLState:",F)}}function J(){try{r.texImage2D(...arguments)}catch(F){Qt("WebGLState:",F)}}function tt(){try{r.texImage3D(...arguments)}catch(F){Qt("WebGLState:",F)}}function ct(F){return d[F]!==void 0?d[F]:r.getParameter(F)}function At(F,lt){d[F]!==lt&&(r.pixelStorei(F,lt),d[F]=lt)}function ft(F){bt.equals(F)===!1&&(r.scissor(F.x,F.y,F.z,F.w),bt.copy(F))}function ut(F){_t.equals(F)===!1&&(r.viewport(F.x,F.y,F.z,F.w),_t.copy(F))}function It(F,lt){let j=h.get(lt);j===void 0&&(j=new WeakMap,h.set(lt,j));let dt=j.get(F);dt===void 0&&(dt=r.getUniformBlockIndex(lt,F.name),j.set(F,dt))}function Lt(F,lt){const dt=h.get(lt).get(F);l.get(lt)!==dt&&(r.uniformBlockBinding(lt,dt,F.__bindingPointIndex),l.set(lt,dt))}function Bt(){r.disable(r.BLEND),r.disable(r.CULL_FACE),r.disable(r.DEPTH_TEST),r.disable(r.POLYGON_OFFSET_FILL),r.disable(r.SCISSOR_TEST),r.disable(r.STENCIL_TEST),r.disable(r.SAMPLE_ALPHA_TO_COVERAGE),r.blendEquation(r.FUNC_ADD),r.blendFunc(r.ONE,r.ZERO),r.blendFuncSeparate(r.ONE,r.ZERO,r.ONE,r.ZERO),r.blendColor(0,0,0,0),r.colorMask(!0,!0,!0,!0),r.clearColor(0,0,0,0),r.depthMask(!0),r.depthFunc(r.LESS),a.setReversed(!1),r.clearDepth(1),r.stencilMask(4294967295),r.stencilFunc(r.ALWAYS,0,4294967295),r.stencilOp(r.KEEP,r.KEEP,r.KEEP),r.clearStencil(0),r.cullFace(r.BACK),r.frontFace(r.CCW),r.polygonOffset(0,0),r.activeTexture(r.TEXTURE0),r.bindFramebuffer(r.FRAMEBUFFER,null),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),r.bindFramebuffer(r.READ_FRAMEBUFFER,null),r.useProgram(null),r.lineWidth(1),r.scissor(0,0,r.canvas.width,r.canvas.height),r.viewport(0,0,r.canvas.width,r.canvas.height),r.pixelStorei(r.PACK_ALIGNMENT,4),r.pixelStorei(r.UNPACK_ALIGNMENT,4),r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,!1),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,r.BROWSER_DEFAULT_WEBGL),r.pixelStorei(r.PACK_ROW_LENGTH,0),r.pixelStorei(r.PACK_SKIP_PIXELS,0),r.pixelStorei(r.PACK_SKIP_ROWS,0),r.pixelStorei(r.UNPACK_ROW_LENGTH,0),r.pixelStorei(r.UNPACK_IMAGE_HEIGHT,0),r.pixelStorei(r.UNPACK_SKIP_PIXELS,0),r.pixelStorei(r.UNPACK_SKIP_ROWS,0),r.pixelStorei(r.UNPACK_SKIP_IMAGES,0),c={},d={},st=null,rt={},u={},f=new WeakMap,p=[],x=null,m=!1,g=null,v=null,S=null,_=null,E=null,b=null,A=null,y=new zt(0,0,0),w=0,C=!1,R=null,I=null,z=null,G=null,L=null,bt.set(0,0,r.canvas.width,r.canvas.height),_t.set(0,0,r.canvas.width,r.canvas.height),s.reset(),a.reset(),o.reset()}return{buffers:{color:s,depth:a,stencil:o},enable:et,disable:Rt,bindFramebuffer:Dt,drawBuffers:yt,useProgram:te,setBlending:kt,setMaterial:Ot,setFlipSided:se,setCullFace:me,setLineWidth:xe,setPolygonOffset:be,setScissorTest:ye,activeTexture:Ae,bindTexture:O,unbindTexture:Qe,compressedTexImage2D:ee,compressedTexImage3D:P,texImage2D:J,texImage3D:tt,pixelStorei:At,getParameter:ct,updateUBOMapping:It,uniformBlockBinding:Lt,texStorage2D:ot,texStorage3D:ht,texSubImage2D:M,texSubImage3D:V,compressedTexSubImage2D:q,compressedTexSubImage3D:K,scissor:ft,viewport:ut,reset:Bt}}function av(r,t,e,i,n,s,a){const o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new Ut,c=new WeakMap,d=new Set;let u;const f=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function x(P,M){return p?new OffscreenCanvas(P,M):Fo("canvas")}function m(P,M,V){let q=1;const K=ee(P);if((K.width>V||K.height>V)&&(q=V/Math.max(K.width,K.height)),q<1)if(typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&P instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&P instanceof ImageBitmap||typeof VideoFrame<"u"&&P instanceof VideoFrame){const ot=Math.floor(q*K.width),ht=Math.floor(q*K.height);u===void 0&&(u=x(ot,ht));const J=M?x(ot,ht):u;return J.width=ot,J.height=ht,J.getContext("2d").drawImage(P,0,0,ot,ht),Nt("WebGLRenderer: Texture has been resized from ("+K.width+"x"+K.height+") to ("+ot+"x"+ht+")."),J}else return"data"in P&&Nt("WebGLRenderer: Image in DataTexture is too big ("+K.width+"x"+K.height+")."),P;return P}function g(P){return P.generateMipmaps}function v(P){r.generateMipmap(P)}function S(P){return P.isWebGLCubeRenderTarget?r.TEXTURE_CUBE_MAP:P.isWebGL3DRenderTarget?r.TEXTURE_3D:P.isWebGLArrayRenderTarget||P.isCompressedArrayTexture?r.TEXTURE_2D_ARRAY:r.TEXTURE_2D}function _(P,M,V,q,K,ot=!1){if(P!==null){if(r[P]!==void 0)return r[P];Nt("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+P+"'")}let ht;q&&(ht=t.get("EXT_texture_norm16"),ht||Nt("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let J=M;if(M===r.RED&&(V===r.FLOAT&&(J=r.R32F),V===r.HALF_FLOAT&&(J=r.R16F),V===r.UNSIGNED_BYTE&&(J=r.R8),V===r.UNSIGNED_SHORT&&ht&&(J=ht.R16_EXT),V===r.SHORT&&ht&&(J=ht.R16_SNORM_EXT)),M===r.RED_INTEGER&&(V===r.UNSIGNED_BYTE&&(J=r.R8UI),V===r.UNSIGNED_SHORT&&(J=r.R16UI),V===r.UNSIGNED_INT&&(J=r.R32UI),V===r.BYTE&&(J=r.R8I),V===r.SHORT&&(J=r.R16I),V===r.INT&&(J=r.R32I)),M===r.RG&&(V===r.FLOAT&&(J=r.RG32F),V===r.HALF_FLOAT&&(J=r.RG16F),V===r.UNSIGNED_BYTE&&(J=r.RG8),V===r.UNSIGNED_SHORT&&ht&&(J=ht.RG16_EXT),V===r.SHORT&&ht&&(J=ht.RG16_SNORM_EXT)),M===r.RG_INTEGER&&(V===r.UNSIGNED_BYTE&&(J=r.RG8UI),V===r.UNSIGNED_SHORT&&(J=r.RG16UI),V===r.UNSIGNED_INT&&(J=r.RG32UI),V===r.BYTE&&(J=r.RG8I),V===r.SHORT&&(J=r.RG16I),V===r.INT&&(J=r.RG32I)),M===r.RGB_INTEGER&&(V===r.UNSIGNED_BYTE&&(J=r.RGB8UI),V===r.UNSIGNED_SHORT&&(J=r.RGB16UI),V===r.UNSIGNED_INT&&(J=r.RGB32UI),V===r.BYTE&&(J=r.RGB8I),V===r.SHORT&&(J=r.RGB16I),V===r.INT&&(J=r.RGB32I)),M===r.RGBA_INTEGER&&(V===r.UNSIGNED_BYTE&&(J=r.RGBA8UI),V===r.UNSIGNED_SHORT&&(J=r.RGBA16UI),V===r.UNSIGNED_INT&&(J=r.RGBA32UI),V===r.BYTE&&(J=r.RGBA8I),V===r.SHORT&&(J=r.RGBA16I),V===r.INT&&(J=r.RGBA32I)),M===r.RGB&&(V===r.UNSIGNED_SHORT&&ht&&(J=ht.RGB16_EXT),V===r.SHORT&&ht&&(J=ht.RGB16_SNORM_EXT),V===r.UNSIGNED_INT_5_9_9_9_REV&&(J=r.RGB9_E5),V===r.UNSIGNED_INT_10F_11F_11F_REV&&(J=r.R11F_G11F_B10F)),M===r.RGBA){const tt=ot?No:Zt.getTransfer(K);V===r.FLOAT&&(J=r.RGBA32F),V===r.HALF_FLOAT&&(J=r.RGBA16F),V===r.UNSIGNED_BYTE&&(J=tt===ie?r.SRGB8_ALPHA8:r.RGBA8),V===r.UNSIGNED_SHORT&&ht&&(J=ht.RGBA16_EXT),V===r.SHORT&&ht&&(J=ht.RGBA16_SNORM_EXT),V===r.UNSIGNED_SHORT_4_4_4_4&&(J=r.RGBA4),V===r.UNSIGNED_SHORT_5_5_5_1&&(J=r.RGB5_A1)}return(J===r.R16F||J===r.R32F||J===r.RG16F||J===r.RG32F||J===r.RGBA16F||J===r.RGBA32F)&&t.get("EXT_color_buffer_float"),J}function E(P,M){let V;return P?M===null||M===Gi||M===ra?V=r.DEPTH24_STENCIL8:M===Ei?V=r.DEPTH32F_STENCIL8:M===sa&&(V=r.DEPTH24_STENCIL8,Nt("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):M===null||M===Gi||M===ra?V=r.DEPTH_COMPONENT24:M===Ei?V=r.DEPTH_COMPONENT32F:M===sa&&(V=r.DEPTH_COMPONENT16),V}function b(P,M){return g(P)===!0||P.isFramebufferTexture&&P.minFilter!==Oe&&P.minFilter!==qe?Math.log2(Math.max(M.width,M.height))+1:P.mipmaps!==void 0&&P.mipmaps.length>0?P.mipmaps.length:P.isCompressedTexture&&Array.isArray(P.image)?M.mipmaps.length:1}function A(P){const M=P.target;M.removeEventListener("dispose",A),w(M),M.isVideoTexture&&c.delete(M),M.isHTMLTexture&&d.delete(M)}function y(P){const M=P.target;M.removeEventListener("dispose",y),R(M)}function w(P){const M=i.get(P);if(M.__webglInit===void 0)return;const V=P.source,q=f.get(V);if(q){const K=q[M.__cacheKey];K.usedTimes--,K.usedTimes===0&&C(P),Object.keys(q).length===0&&f.delete(V)}i.remove(P)}function C(P){const M=i.get(P);r.deleteTexture(M.__webglTexture);const V=P.source,q=f.get(V);delete q[M.__cacheKey],a.memory.textures--}function R(P){const M=i.get(P);if(P.depthTexture&&(P.depthTexture.dispose(),i.remove(P.depthTexture)),P.isWebGLCubeRenderTarget)for(let q=0;q<6;q++){if(Array.isArray(M.__webglFramebuffer[q]))for(let K=0;K<M.__webglFramebuffer[q].length;K++)r.deleteFramebuffer(M.__webglFramebuffer[q][K]);else r.deleteFramebuffer(M.__webglFramebuffer[q]);M.__webglDepthbuffer&&r.deleteRenderbuffer(M.__webglDepthbuffer[q])}else{if(Array.isArray(M.__webglFramebuffer))for(let q=0;q<M.__webglFramebuffer.length;q++)r.deleteFramebuffer(M.__webglFramebuffer[q]);else r.deleteFramebuffer(M.__webglFramebuffer);if(M.__webglDepthbuffer&&r.deleteRenderbuffer(M.__webglDepthbuffer),M.__webglMultisampledFramebuffer&&r.deleteFramebuffer(M.__webglMultisampledFramebuffer),M.__webglColorRenderbuffer)for(let q=0;q<M.__webglColorRenderbuffer.length;q++)M.__webglColorRenderbuffer[q]&&r.deleteRenderbuffer(M.__webglColorRenderbuffer[q]);M.__webglDepthRenderbuffer&&r.deleteRenderbuffer(M.__webglDepthRenderbuffer)}const V=P.textures;for(let q=0,K=V.length;q<K;q++){const ot=i.get(V[q]);ot.__webglTexture&&(r.deleteTexture(ot.__webglTexture),a.memory.textures--),i.remove(V[q])}i.remove(P)}let I=0;function z(){I=0}function G(){return I}function L(P){I=P}function N(){const P=I;return P>=n.maxTextures&&Nt("WebGLTextures: Trying to use "+P+" texture units while this GPU supports only "+n.maxTextures),I+=1,P}function D(P){const M=[];return M.push(P.wrapS),M.push(P.wrapT),M.push(P.wrapR||0),M.push(P.magFilter),M.push(P.minFilter),M.push(P.anisotropy),M.push(P.internalFormat),M.push(P.format),M.push(P.type),M.push(P.generateMipmaps),M.push(P.premultiplyAlpha),M.push(P.flipY),M.push(P.unpackAlignment),M.push(P.colorSpace),M.join()}function $(P,M){const V=i.get(P);if(P.isVideoTexture&&O(P),P.isRenderTargetTexture===!1&&P.isExternalTexture!==!0&&P.version>0&&V.__version!==P.version){const q=P.image;if(q===null)Nt("WebGLRenderer: Texture marked for update but no image data found.");else if(q.complete===!1)Nt("WebGLRenderer: Texture marked for update but image is incomplete");else{Rt(V,P,M);return}}else P.isExternalTexture&&(V.__webglTexture=P.sourceTexture?P.sourceTexture:null);e.bindTexture(r.TEXTURE_2D,V.__webglTexture,r.TEXTURE0+M)}function Q(P,M){const V=i.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&V.__version!==P.version){Rt(V,P,M);return}else P.isExternalTexture&&(V.__webglTexture=P.sourceTexture?P.sourceTexture:null);e.bindTexture(r.TEXTURE_2D_ARRAY,V.__webglTexture,r.TEXTURE0+M)}function st(P,M){const V=i.get(P);if(P.isRenderTargetTexture===!1&&P.version>0&&V.__version!==P.version){Rt(V,P,M);return}e.bindTexture(r.TEXTURE_3D,V.__webglTexture,r.TEXTURE0+M)}function rt(P,M){const V=i.get(P);if(P.isCubeDepthTexture!==!0&&P.version>0&&V.__version!==P.version){Dt(V,P,M);return}e.bindTexture(r.TEXTURE_CUBE_MAP,V.__webglTexture,r.TEXTURE0+M)}const U={[gh]:r.REPEAT,[nn]:r.CLAMP_TO_EDGE,[xh]:r.MIRRORED_REPEAT},at={[Oe]:r.NEAREST,[om]:r.NEAREST_MIPMAP_NEAREST,[pa]:r.NEAREST_MIPMAP_LINEAR,[qe]:r.LINEAR,[Zo]:r.LINEAR_MIPMAP_NEAREST,[is]:r.LINEAR_MIPMAP_LINEAR},bt={[cm]:r.NEVER,[mm]:r.ALWAYS,[um]:r.LESS,[yc]:r.LEQUAL,[dm]:r.EQUAL,[_c]:r.GEQUAL,[fm]:r.GREATER,[pm]:r.NOTEQUAL};function _t(P,M){if(M.type===Ei&&t.has("OES_texture_float_linear")===!1&&(M.magFilter===qe||M.magFilter===Zo||M.magFilter===pa||M.magFilter===is||M.minFilter===qe||M.minFilter===Zo||M.minFilter===pa||M.minFilter===is)&&Nt("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),r.texParameteri(P,r.TEXTURE_WRAP_S,U[M.wrapS]),r.texParameteri(P,r.TEXTURE_WRAP_T,U[M.wrapT]),(P===r.TEXTURE_3D||P===r.TEXTURE_2D_ARRAY)&&r.texParameteri(P,r.TEXTURE_WRAP_R,U[M.wrapR]),r.texParameteri(P,r.TEXTURE_MAG_FILTER,at[M.magFilter]),r.texParameteri(P,r.TEXTURE_MIN_FILTER,at[M.minFilter]),M.compareFunction&&(r.texParameteri(P,r.TEXTURE_COMPARE_MODE,r.COMPARE_REF_TO_TEXTURE),r.texParameteri(P,r.TEXTURE_COMPARE_FUNC,bt[M.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(M.magFilter===Oe||M.minFilter!==pa&&M.minFilter!==is||M.type===Ei&&t.has("OES_texture_float_linear")===!1)return;if(M.anisotropy>1||i.get(M).__currentAnisotropy){const V=t.get("EXT_texture_filter_anisotropic");r.texParameterf(P,V.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(M.anisotropy,n.getMaxAnisotropy())),i.get(M).__currentAnisotropy=M.anisotropy}}}function X(P,M){let V=!1;P.__webglInit===void 0&&(P.__webglInit=!0,M.addEventListener("dispose",A));const q=M.source;let K=f.get(q);K===void 0&&(K={},f.set(q,K));const ot=D(M);if(ot!==P.__cacheKey){K[ot]===void 0&&(K[ot]={texture:r.createTexture(),usedTimes:0},a.memory.textures++,V=!0),K[ot].usedTimes++;const ht=K[P.__cacheKey];ht!==void 0&&(K[P.__cacheKey].usedTimes--,ht.usedTimes===0&&C(M)),P.__cacheKey=ot,P.__webglTexture=K[ot].texture}return V}function nt(P,M,V){return Math.floor(Math.floor(P/V)/M)}function et(P,M,V,q){const ot=P.updateRanges;if(ot.length===0)e.texSubImage2D(r.TEXTURE_2D,0,0,0,M.width,M.height,V,q,M.data);else{ot.sort((At,ft)=>At.start-ft.start);let ht=0;for(let At=1;At<ot.length;At++){const ft=ot[ht],ut=ot[At],It=ft.start+ft.count,Lt=nt(ut.start,M.width,4),Bt=nt(ft.start,M.width,4);ut.start<=It+1&&Lt===Bt&&nt(ut.start+ut.count-1,M.width,4)===Lt?ft.count=Math.max(ft.count,ut.start+ut.count-ft.start):(++ht,ot[ht]=ut)}ot.length=ht+1;const J=e.getParameter(r.UNPACK_ROW_LENGTH),tt=e.getParameter(r.UNPACK_SKIP_PIXELS),ct=e.getParameter(r.UNPACK_SKIP_ROWS);e.pixelStorei(r.UNPACK_ROW_LENGTH,M.width);for(let At=0,ft=ot.length;At<ft;At++){const ut=ot[At],It=Math.floor(ut.start/4),Lt=Math.ceil(ut.count/4),Bt=It%M.width,F=Math.floor(It/M.width),lt=Lt,j=1;e.pixelStorei(r.UNPACK_SKIP_PIXELS,Bt),e.pixelStorei(r.UNPACK_SKIP_ROWS,F),e.texSubImage2D(r.TEXTURE_2D,0,Bt,F,lt,j,V,q,M.data)}P.clearUpdateRanges(),e.pixelStorei(r.UNPACK_ROW_LENGTH,J),e.pixelStorei(r.UNPACK_SKIP_PIXELS,tt),e.pixelStorei(r.UNPACK_SKIP_ROWS,ct)}}function Rt(P,M,V){let q=r.TEXTURE_2D;(M.isDataArrayTexture||M.isCompressedArrayTexture)&&(q=r.TEXTURE_2D_ARRAY),M.isData3DTexture&&(q=r.TEXTURE_3D);const K=X(P,M),ot=M.source;e.bindTexture(q,P.__webglTexture,r.TEXTURE0+V);const ht=i.get(ot);if(ot.version!==ht.__version||K===!0){if(e.activeTexture(r.TEXTURE0+V),(typeof ImageBitmap<"u"&&M.image instanceof ImageBitmap)===!1){const j=Zt.getPrimaries(Zt.workingColorSpace),dt=M.colorSpace===Pn?null:Zt.getPrimaries(M.colorSpace),xt=M.colorSpace===Pn||j===dt?r.NONE:r.BROWSER_DEFAULT_WEBGL;e.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,M.flipY),e.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),e.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,xt)}e.pixelStorei(r.UNPACK_ALIGNMENT,M.unpackAlignment);let tt=m(M.image,!1,n.maxTextureSize);tt=Qe(M,tt);const ct=s.convert(M.format,M.colorSpace),At=s.convert(M.type);let ft=_(M.internalFormat,ct,At,M.normalized,M.colorSpace,M.isVideoTexture);_t(q,M);let ut;const It=M.mipmaps,Lt=M.isVideoTexture!==!0,Bt=ht.__version===void 0||K===!0,F=ot.dataReady,lt=b(M,tt);if(M.isDepthTexture)ft=E(M.format===ns,M.type),Bt&&(Lt?e.texStorage2D(r.TEXTURE_2D,1,ft,tt.width,tt.height):e.texImage2D(r.TEXTURE_2D,0,ft,tt.width,tt.height,0,ct,At,null));else if(M.isDataTexture)if(It.length>0){Lt&&Bt&&e.texStorage2D(r.TEXTURE_2D,lt,ft,It[0].width,It[0].height);for(let j=0,dt=It.length;j<dt;j++)ut=It[j],Lt?F&&e.texSubImage2D(r.TEXTURE_2D,j,0,0,ut.width,ut.height,ct,At,ut.data):e.texImage2D(r.TEXTURE_2D,j,ft,ut.width,ut.height,0,ct,At,ut.data);M.generateMipmaps=!1}else Lt?(Bt&&e.texStorage2D(r.TEXTURE_2D,lt,ft,tt.width,tt.height),F&&et(M,tt,ct,At)):e.texImage2D(r.TEXTURE_2D,0,ft,tt.width,tt.height,0,ct,At,tt.data);else if(M.isCompressedTexture)if(M.isCompressedArrayTexture){Lt&&Bt&&e.texStorage3D(r.TEXTURE_2D_ARRAY,lt,ft,It[0].width,It[0].height,tt.depth);for(let j=0,dt=It.length;j<dt;j++)if(ut=It[j],M.format!==Ti)if(ct!==null)if(Lt){if(F)if(M.layerUpdates.size>0){const xt=Cu(ut.width,ut.height,M.format,M.type);for(const it of M.layerUpdates){const Tt=ut.data.subarray(it*xt/ut.data.BYTES_PER_ELEMENT,(it+1)*xt/ut.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,j,0,0,it,ut.width,ut.height,1,ct,Tt)}M.clearLayerUpdates()}else e.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,j,0,0,0,ut.width,ut.height,tt.depth,ct,ut.data)}else e.compressedTexImage3D(r.TEXTURE_2D_ARRAY,j,ft,ut.width,ut.height,tt.depth,0,ut.data,0,0);else Nt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Lt?F&&e.texSubImage3D(r.TEXTURE_2D_ARRAY,j,0,0,0,ut.width,ut.height,tt.depth,ct,At,ut.data):e.texImage3D(r.TEXTURE_2D_ARRAY,j,ft,ut.width,ut.height,tt.depth,0,ct,At,ut.data)}else{Lt&&Bt&&e.texStorage2D(r.TEXTURE_2D,lt,ft,It[0].width,It[0].height);for(let j=0,dt=It.length;j<dt;j++)ut=It[j],M.format!==Ti?ct!==null?Lt?F&&e.compressedTexSubImage2D(r.TEXTURE_2D,j,0,0,ut.width,ut.height,ct,ut.data):e.compressedTexImage2D(r.TEXTURE_2D,j,ft,ut.width,ut.height,0,ut.data):Nt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Lt?F&&e.texSubImage2D(r.TEXTURE_2D,j,0,0,ut.width,ut.height,ct,At,ut.data):e.texImage2D(r.TEXTURE_2D,j,ft,ut.width,ut.height,0,ct,At,ut.data)}else if(M.isDataArrayTexture)if(Lt){if(Bt&&e.texStorage3D(r.TEXTURE_2D_ARRAY,lt,ft,tt.width,tt.height,tt.depth),F)if(M.layerUpdates.size>0){const j=Cu(tt.width,tt.height,M.format,M.type);for(const dt of M.layerUpdates){const xt=tt.data.subarray(dt*j/tt.data.BYTES_PER_ELEMENT,(dt+1)*j/tt.data.BYTES_PER_ELEMENT);e.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,dt,tt.width,tt.height,1,ct,At,xt)}M.clearLayerUpdates()}else e.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,0,tt.width,tt.height,tt.depth,ct,At,tt.data)}else e.texImage3D(r.TEXTURE_2D_ARRAY,0,ft,tt.width,tt.height,tt.depth,0,ct,At,tt.data);else if(M.isData3DTexture)Lt?(Bt&&e.texStorage3D(r.TEXTURE_3D,lt,ft,tt.width,tt.height,tt.depth),F&&e.texSubImage3D(r.TEXTURE_3D,0,0,0,0,tt.width,tt.height,tt.depth,ct,At,tt.data)):e.texImage3D(r.TEXTURE_3D,0,ft,tt.width,tt.height,tt.depth,0,ct,At,tt.data);else if(M.isFramebufferTexture){if(Bt)if(Lt)e.texStorage2D(r.TEXTURE_2D,lt,ft,tt.width,tt.height);else{let j=tt.width,dt=tt.height;for(let xt=0;xt<lt;xt++)e.texImage2D(r.TEXTURE_2D,xt,ft,j,dt,0,ct,At,null),j>>=1,dt>>=1}}else if(M.isHTMLTexture){if("texElementImage2D"in r){const j=r.canvas;if(j.hasAttribute("layoutsubtree")||j.setAttribute("layoutsubtree","true"),tt.parentNode!==j){j.appendChild(tt),d.add(M),j.onpaint=dt=>{const xt=dt.changedElements;for(const it of d)xt.includes(it.image)&&(it.needsUpdate=!0)},j.requestPaint();return}if(r.texElementImage2D.length===3)r.texElementImage2D(r.TEXTURE_2D,r.RGBA8,tt);else{const xt=r.RGBA,it=r.RGBA,Tt=r.UNSIGNED_BYTE;r.texElementImage2D(r.TEXTURE_2D,0,xt,it,Tt,tt)}r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE)}}else if(It.length>0){if(Lt&&Bt){const j=ee(It[0]);e.texStorage2D(r.TEXTURE_2D,lt,ft,j.width,j.height)}for(let j=0,dt=It.length;j<dt;j++)ut=It[j],Lt?F&&e.texSubImage2D(r.TEXTURE_2D,j,0,0,ct,At,ut):e.texImage2D(r.TEXTURE_2D,j,ft,ct,At,ut);M.generateMipmaps=!1}else if(Lt){if(Bt){const j=ee(tt);e.texStorage2D(r.TEXTURE_2D,lt,ft,j.width,j.height)}F&&e.texSubImage2D(r.TEXTURE_2D,0,0,0,ct,At,tt)}else e.texImage2D(r.TEXTURE_2D,0,ft,ct,At,tt);g(M)&&v(q),ht.__version=ot.version,M.onUpdate&&M.onUpdate(M)}P.__version=M.version}function Dt(P,M,V){if(M.image.length!==6)return;const q=X(P,M),K=M.source;e.bindTexture(r.TEXTURE_CUBE_MAP,P.__webglTexture,r.TEXTURE0+V);const ot=i.get(K);if(K.version!==ot.__version||q===!0){e.activeTexture(r.TEXTURE0+V);const ht=Zt.getPrimaries(Zt.workingColorSpace),J=M.colorSpace===Pn?null:Zt.getPrimaries(M.colorSpace),tt=M.colorSpace===Pn||ht===J?r.NONE:r.BROWSER_DEFAULT_WEBGL;e.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,M.flipY),e.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,M.premultiplyAlpha),e.pixelStorei(r.UNPACK_ALIGNMENT,M.unpackAlignment),e.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,tt);const ct=M.isCompressedTexture||M.image[0].isCompressedTexture,At=M.image[0]&&M.image[0].isDataTexture,ft=[];for(let it=0;it<6;it++)!ct&&!At?ft[it]=m(M.image[it],!0,n.maxCubemapSize):ft[it]=At?M.image[it].image:M.image[it],ft[it]=Qe(M,ft[it]);const ut=ft[0],It=s.convert(M.format,M.colorSpace),Lt=s.convert(M.type),Bt=_(M.internalFormat,It,Lt,M.normalized,M.colorSpace),F=M.isVideoTexture!==!0,lt=ot.__version===void 0||q===!0,j=K.dataReady;let dt=b(M,ut);_t(r.TEXTURE_CUBE_MAP,M);let xt;if(ct){F&&lt&&e.texStorage2D(r.TEXTURE_CUBE_MAP,dt,Bt,ut.width,ut.height);for(let it=0;it<6;it++){xt=ft[it].mipmaps;for(let Tt=0;Tt<xt.length;Tt++){const wt=xt[Tt];M.format!==Ti?It!==null?F?j&&e.compressedTexSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt,0,0,wt.width,wt.height,It,wt.data):e.compressedTexImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt,Bt,wt.width,wt.height,0,wt.data):Nt("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):F?j&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt,0,0,wt.width,wt.height,It,Lt,wt.data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt,Bt,wt.width,wt.height,0,It,Lt,wt.data)}}}else{if(xt=M.mipmaps,F&&lt){xt.length>0&&dt++;const it=ee(ft[0]);e.texStorage2D(r.TEXTURE_CUBE_MAP,dt,Bt,it.width,it.height)}for(let it=0;it<6;it++)if(At){F?j&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,0,0,0,ft[it].width,ft[it].height,It,Lt,ft[it].data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,0,Bt,ft[it].width,ft[it].height,0,It,Lt,ft[it].data);for(let Tt=0;Tt<xt.length;Tt++){const _e=xt[Tt].image[it].image;F?j&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt+1,0,0,_e.width,_e.height,It,Lt,_e.data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt+1,Bt,_e.width,_e.height,0,It,Lt,_e.data)}}else{F?j&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,0,0,0,It,Lt,ft[it]):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,0,Bt,It,Lt,ft[it]);for(let Tt=0;Tt<xt.length;Tt++){const wt=xt[Tt];F?j&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt+1,0,0,It,Lt,wt.image[it]):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+it,Tt+1,Bt,It,Lt,wt.image[it])}}}g(M)&&v(r.TEXTURE_CUBE_MAP),ot.__version=K.version,M.onUpdate&&M.onUpdate(M)}P.__version=M.version}function yt(P,M,V,q,K,ot){const ht=s.convert(V.format,V.colorSpace),J=s.convert(V.type),tt=_(V.internalFormat,ht,J,V.normalized,V.colorSpace),ct=i.get(M),At=i.get(V);if(At.__renderTarget=M,!ct.__hasExternalTextures){const ft=Math.max(1,M.width>>ot),ut=Math.max(1,M.height>>ot);K===r.TEXTURE_3D||K===r.TEXTURE_2D_ARRAY?e.texImage3D(K,ot,tt,ft,ut,M.depth,0,ht,J,null):e.texImage2D(K,ot,tt,ft,ut,0,ht,J,null)}e.bindFramebuffer(r.FRAMEBUFFER,P),Ae(M)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,q,K,At.__webglTexture,0,ye(M)):(K===r.TEXTURE_2D||K>=r.TEXTURE_CUBE_MAP_POSITIVE_X&&K<=r.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&r.framebufferTexture2D(r.FRAMEBUFFER,q,K,At.__webglTexture,ot),e.bindFramebuffer(r.FRAMEBUFFER,null)}function te(P,M,V){if(r.bindRenderbuffer(r.RENDERBUFFER,P),M.depthBuffer){const q=M.depthTexture,K=q&&q.isDepthTexture?q.type:null,ot=E(M.stencilBuffer,K),ht=M.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;Ae(M)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,ye(M),ot,M.width,M.height):V?r.renderbufferStorageMultisample(r.RENDERBUFFER,ye(M),ot,M.width,M.height):r.renderbufferStorage(r.RENDERBUFFER,ot,M.width,M.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,ht,r.RENDERBUFFER,P)}else{const q=M.textures;for(let K=0;K<q.length;K++){const ot=q[K],ht=s.convert(ot.format,ot.colorSpace),J=s.convert(ot.type),tt=_(ot.internalFormat,ht,J,ot.normalized,ot.colorSpace);Ae(M)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,ye(M),tt,M.width,M.height):V?r.renderbufferStorageMultisample(r.RENDERBUFFER,ye(M),tt,M.width,M.height):r.renderbufferStorage(r.RENDERBUFFER,tt,M.width,M.height)}}r.bindRenderbuffer(r.RENDERBUFFER,null)}function St(P,M,V){const q=M.isWebGLCubeRenderTarget===!0;if(e.bindFramebuffer(r.FRAMEBUFFER,P),!(M.depthTexture&&M.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");const K=i.get(M.depthTexture);if(K.__renderTarget=M,(!K.__webglTexture||M.depthTexture.image.width!==M.width||M.depthTexture.image.height!==M.height)&&(M.depthTexture.image.width=M.width,M.depthTexture.image.height=M.height,M.depthTexture.needsUpdate=!0),q){if(K.__webglInit===void 0&&(K.__webglInit=!0,M.depthTexture.addEventListener("dispose",A)),K.__webglTexture===void 0){K.__webglTexture=r.createTexture(),e.bindTexture(r.TEXTURE_CUBE_MAP,K.__webglTexture),_t(r.TEXTURE_CUBE_MAP,M.depthTexture);const ct=s.convert(M.depthTexture.format),At=s.convert(M.depthTexture.type);let ft;M.depthTexture.format===ln?ft=r.DEPTH_COMPONENT24:M.depthTexture.format===ns&&(ft=r.DEPTH24_STENCIL8);for(let ut=0;ut<6;ut++)r.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+ut,0,ft,M.width,M.height,0,ct,At,null)}}else $(M.depthTexture,0);const ot=K.__webglTexture,ht=ye(M),J=q?r.TEXTURE_CUBE_MAP_POSITIVE_X+V:r.TEXTURE_2D,tt=M.depthTexture.format===ns?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;if(M.depthTexture.format===ln)Ae(M)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,tt,J,ot,0,ht):r.framebufferTexture2D(r.FRAMEBUFFER,tt,J,ot,0);else if(M.depthTexture.format===ns)Ae(M)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,tt,J,ot,0,ht):r.framebufferTexture2D(r.FRAMEBUFFER,tt,J,ot,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function Ft(P){const M=i.get(P),V=P.isWebGLCubeRenderTarget===!0;if(M.__boundDepthTexture!==P.depthTexture){const q=P.depthTexture;if(M.__depthDisposeCallback&&M.__depthDisposeCallback(),q){const K=()=>{delete M.__boundDepthTexture,delete M.__depthDisposeCallback,q.removeEventListener("dispose",K)};q.addEventListener("dispose",K),M.__depthDisposeCallback=K}M.__boundDepthTexture=q}if(P.depthTexture&&!M.__autoAllocateDepthBuffer)if(V)for(let q=0;q<6;q++)St(M.__webglFramebuffer[q],P,q);else{const q=P.texture.mipmaps;q&&q.length>0?St(M.__webglFramebuffer[0],P,0):St(M.__webglFramebuffer,P,0)}else if(V){M.__webglDepthbuffer=[];for(let q=0;q<6;q++)if(e.bindFramebuffer(r.FRAMEBUFFER,M.__webglFramebuffer[q]),M.__webglDepthbuffer[q]===void 0)M.__webglDepthbuffer[q]=r.createRenderbuffer(),te(M.__webglDepthbuffer[q],P,!1);else{const K=P.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,ot=M.__webglDepthbuffer[q];r.bindRenderbuffer(r.RENDERBUFFER,ot),r.framebufferRenderbuffer(r.FRAMEBUFFER,K,r.RENDERBUFFER,ot)}}else{const q=P.texture.mipmaps;if(q&&q.length>0?e.bindFramebuffer(r.FRAMEBUFFER,M.__webglFramebuffer[0]):e.bindFramebuffer(r.FRAMEBUFFER,M.__webglFramebuffer),M.__webglDepthbuffer===void 0)M.__webglDepthbuffer=r.createRenderbuffer(),te(M.__webglDepthbuffer,P,!1);else{const K=P.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,ot=M.__webglDepthbuffer;r.bindRenderbuffer(r.RENDERBUFFER,ot),r.framebufferRenderbuffer(r.FRAMEBUFFER,K,r.RENDERBUFFER,ot)}}e.bindFramebuffer(r.FRAMEBUFFER,null)}function kt(P,M,V){const q=i.get(P);M!==void 0&&yt(q.__webglFramebuffer,P,P.texture,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,0),V!==void 0&&Ft(P)}function Ot(P){const M=P.texture,V=i.get(P),q=i.get(M);P.addEventListener("dispose",y);const K=P.textures,ot=P.isWebGLCubeRenderTarget===!0,ht=K.length>1;if(ht||(q.__webglTexture===void 0&&(q.__webglTexture=r.createTexture()),q.__version=M.version,a.memory.textures++),ot){V.__webglFramebuffer=[];for(let J=0;J<6;J++)if(M.mipmaps&&M.mipmaps.length>0){V.__webglFramebuffer[J]=[];for(let tt=0;tt<M.mipmaps.length;tt++)V.__webglFramebuffer[J][tt]=r.createFramebuffer()}else V.__webglFramebuffer[J]=r.createFramebuffer()}else{if(M.mipmaps&&M.mipmaps.length>0){V.__webglFramebuffer=[];for(let J=0;J<M.mipmaps.length;J++)V.__webglFramebuffer[J]=r.createFramebuffer()}else V.__webglFramebuffer=r.createFramebuffer();if(ht)for(let J=0,tt=K.length;J<tt;J++){const ct=i.get(K[J]);ct.__webglTexture===void 0&&(ct.__webglTexture=r.createTexture(),a.memory.textures++)}if(P.samples>0&&Ae(P)===!1){V.__webglMultisampledFramebuffer=r.createFramebuffer(),V.__webglColorRenderbuffer=[],e.bindFramebuffer(r.FRAMEBUFFER,V.__webglMultisampledFramebuffer);for(let J=0;J<K.length;J++){const tt=K[J];V.__webglColorRenderbuffer[J]=r.createRenderbuffer(),r.bindRenderbuffer(r.RENDERBUFFER,V.__webglColorRenderbuffer[J]);const ct=s.convert(tt.format,tt.colorSpace),At=s.convert(tt.type),ft=_(tt.internalFormat,ct,At,tt.normalized,tt.colorSpace,P.isXRRenderTarget===!0),ut=ye(P);r.renderbufferStorageMultisample(r.RENDERBUFFER,ut,ft,P.width,P.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+J,r.RENDERBUFFER,V.__webglColorRenderbuffer[J])}r.bindRenderbuffer(r.RENDERBUFFER,null),P.depthBuffer&&(V.__webglDepthRenderbuffer=r.createRenderbuffer(),te(V.__webglDepthRenderbuffer,P,!0)),e.bindFramebuffer(r.FRAMEBUFFER,null)}}if(ot){e.bindTexture(r.TEXTURE_CUBE_MAP,q.__webglTexture),_t(r.TEXTURE_CUBE_MAP,M);for(let J=0;J<6;J++)if(M.mipmaps&&M.mipmaps.length>0)for(let tt=0;tt<M.mipmaps.length;tt++)yt(V.__webglFramebuffer[J][tt],P,M,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+J,tt);else yt(V.__webglFramebuffer[J],P,M,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+J,0);g(M)&&v(r.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(ht){for(let J=0,tt=K.length;J<tt;J++){const ct=K[J],At=i.get(ct);let ft=r.TEXTURE_2D;(P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(ft=P.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),e.bindTexture(ft,At.__webglTexture),_t(ft,ct),yt(V.__webglFramebuffer,P,ct,r.COLOR_ATTACHMENT0+J,ft,0),g(ct)&&v(ft)}e.unbindTexture()}else{let J=r.TEXTURE_2D;if((P.isWebGL3DRenderTarget||P.isWebGLArrayRenderTarget)&&(J=P.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),e.bindTexture(J,q.__webglTexture),_t(J,M),M.mipmaps&&M.mipmaps.length>0)for(let tt=0;tt<M.mipmaps.length;tt++)yt(V.__webglFramebuffer[tt],P,M,r.COLOR_ATTACHMENT0,J,tt);else yt(V.__webglFramebuffer,P,M,r.COLOR_ATTACHMENT0,J,0);g(M)&&v(J),e.unbindTexture()}P.depthBuffer&&Ft(P)}function se(P){const M=P.textures;for(let V=0,q=M.length;V<q;V++){const K=M[V];if(g(K)){const ot=S(P),ht=i.get(K).__webglTexture;e.bindTexture(ot,ht),v(ot),e.unbindTexture()}}}const me=[],xe=[];function be(P){if(P.samples>0){if(Ae(P)===!1){const M=P.textures,V=P.width,q=P.height;let K=r.COLOR_BUFFER_BIT;const ot=P.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,ht=i.get(P),J=M.length>1;if(J)for(let ct=0;ct<M.length;ct++)e.bindFramebuffer(r.FRAMEBUFFER,ht.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+ct,r.RENDERBUFFER,null),e.bindFramebuffer(r.FRAMEBUFFER,ht.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+ct,r.TEXTURE_2D,null,0);e.bindFramebuffer(r.READ_FRAMEBUFFER,ht.__webglMultisampledFramebuffer);const tt=P.texture.mipmaps;tt&&tt.length>0?e.bindFramebuffer(r.DRAW_FRAMEBUFFER,ht.__webglFramebuffer[0]):e.bindFramebuffer(r.DRAW_FRAMEBUFFER,ht.__webglFramebuffer);for(let ct=0;ct<M.length;ct++){if(P.resolveDepthBuffer&&(P.depthBuffer&&(K|=r.DEPTH_BUFFER_BIT),P.stencilBuffer&&P.resolveStencilBuffer&&(K|=r.STENCIL_BUFFER_BIT)),J){r.framebufferRenderbuffer(r.READ_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.RENDERBUFFER,ht.__webglColorRenderbuffer[ct]);const At=i.get(M[ct]).__webglTexture;r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,At,0)}r.blitFramebuffer(0,0,V,q,0,0,V,q,K,r.NEAREST),l===!0&&(me.length=0,xe.length=0,me.push(r.COLOR_ATTACHMENT0+ct),P.depthBuffer&&P.resolveDepthBuffer===!1&&(me.push(ot),xe.push(ot),r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,xe)),r.invalidateFramebuffer(r.READ_FRAMEBUFFER,me))}if(e.bindFramebuffer(r.READ_FRAMEBUFFER,null),e.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),J)for(let ct=0;ct<M.length;ct++){e.bindFramebuffer(r.FRAMEBUFFER,ht.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+ct,r.RENDERBUFFER,ht.__webglColorRenderbuffer[ct]);const At=i.get(M[ct]).__webglTexture;e.bindFramebuffer(r.FRAMEBUFFER,ht.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+ct,r.TEXTURE_2D,At,0)}e.bindFramebuffer(r.DRAW_FRAMEBUFFER,ht.__webglMultisampledFramebuffer)}else if(P.depthBuffer&&P.resolveDepthBuffer===!1&&l){const M=P.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,[M])}}}function ye(P){return Math.min(n.maxSamples,P.samples)}function Ae(P){const M=i.get(P);return P.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&M.__useRenderToTexture!==!1}function O(P){const M=a.render.frame;c.get(P)!==M&&(c.set(P,M),P.update())}function Qe(P,M){const V=P.colorSpace,q=P.format,K=P.type;return P.isCompressedTexture===!0||P.isVideoTexture===!0||V!==Lo&&V!==Pn&&(Zt.getTransfer(V)===ie?(q!==Ti||K!==ui)&&Nt("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Qt("WebGLTextures: Unsupported texture color space:",V)),M}function ee(P){return typeof HTMLImageElement<"u"&&P instanceof HTMLImageElement?(h.width=P.naturalWidth||P.width,h.height=P.naturalHeight||P.height):typeof VideoFrame<"u"&&P instanceof VideoFrame?(h.width=P.displayWidth,h.height=P.displayHeight):(h.width=P.width,h.height=P.height),h}this.allocateTextureUnit=N,this.resetTextureUnits=z,this.getTextureUnits=G,this.setTextureUnits=L,this.setTexture2D=$,this.setTexture2DArray=Q,this.setTexture3D=st,this.setTextureCube=rt,this.rebindTextures=kt,this.setupRenderTarget=Ot,this.updateRenderTargetMipmap=se,this.updateMultisampleRenderTarget=be,this.setupDepthRenderbuffer=Ft,this.setupFrameBufferTexture=yt,this.useMultisampledRTT=Ae,this.isReversedDepthBuffer=function(){return e.buffers.depth.getReversed()}}function ov(r,t){function e(i,n=Pn){let s;const a=Zt.getTransfer(n);if(i===ui)return r.UNSIGNED_BYTE;if(i===dc)return r.UNSIGNED_SHORT_4_4_4_4;if(i===fc)return r.UNSIGNED_SHORT_5_5_5_1;if(i===Ef)return r.UNSIGNED_INT_5_9_9_9_REV;if(i===Tf)return r.UNSIGNED_INT_10F_11F_11F_REV;if(i===Sf)return r.BYTE;if(i===wf)return r.SHORT;if(i===sa)return r.UNSIGNED_SHORT;if(i===uc)return r.INT;if(i===Gi)return r.UNSIGNED_INT;if(i===Ei)return r.FLOAT;if(i===on)return r.HALF_FLOAT;if(i===Af)return r.ALPHA;if(i===Cf)return r.RGB;if(i===Ti)return r.RGBA;if(i===ln)return r.DEPTH_COMPONENT;if(i===ns)return r.DEPTH_STENCIL;if(i===pc)return r.RED;if(i===mc)return r.RED_INTEGER;if(i===rs)return r.RG;if(i===gc)return r.RG_INTEGER;if(i===xc)return r.RGBA_INTEGER;if(i===yo||i===_o||i===vo||i===Mo)if(a===ie)if(s=t.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===yo)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===_o)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===vo)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Mo)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=t.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===yo)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===_o)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===vo)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Mo)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===yh||i===_h||i===vh||i===Mh)if(s=t.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===yh)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===_h)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===vh)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Mh)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===bh||i===Sh||i===wh||i===Eh||i===Th||i===Po||i===Ah)if(s=t.get("WEBGL_compressed_texture_etc"),s!==null){if(i===bh||i===Sh)return a===ie?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===wh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===Eh)return s.COMPRESSED_R11_EAC;if(i===Th)return s.COMPRESSED_SIGNED_R11_EAC;if(i===Po)return s.COMPRESSED_RG11_EAC;if(i===Ah)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===Ch||i===Rh||i===Ph||i===Ih||i===Dh||i===Lh||i===Nh||i===Fh||i===Uh||i===zh||i===Oh||i===kh||i===Bh||i===Vh)if(s=t.get("WEBGL_compressed_texture_astc"),s!==null){if(i===Ch)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Rh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Ph)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Ih)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Dh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Lh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===Nh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Fh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===Uh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===zh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Oh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===kh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Bh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Vh)return a===ie?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Gh||i===Hh||i===Wh)if(s=t.get("EXT_texture_compression_bptc"),s!==null){if(i===Gh)return a===ie?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Hh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Wh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Xh||i===qh||i===Io||i===$h)if(s=t.get("EXT_texture_compression_rgtc"),s!==null){if(i===Xh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===qh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Io)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===$h)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===ra?r.UNSIGNED_INT_24_8:r[i]!==void 0?r[i]:null}return{convert:e}}const lv=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,hv=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class cv{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){const i=new Hf(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,i=new xi({vertexShader:lv,fragmentShader:hv,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Pe(new Wf(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class uv extends Bn{constructor(t,e){super();const i=this;let n=null,s=1,a=null,o="local-floor",l=1,h=null,c=null,d=null,u=null,f=null,p=null;const x=typeof XRWebGLBinding<"u",m=new cv,g={},v=e.getContextAttributes();let S=null,_=null;const E=[],b=[],A=new Ut;let y=null;const w=new hi;w.viewport=new Te;const C=new hi;C.viewport=new Te;const R=[w,C],I=new _0;let z=null,G=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(X){let nt=E[X];return nt===void 0&&(nt=new el,E[X]=nt),nt.getTargetRaySpace()},this.getControllerGrip=function(X){let nt=E[X];return nt===void 0&&(nt=new el,E[X]=nt),nt.getGripSpace()},this.getHand=function(X){let nt=E[X];return nt===void 0&&(nt=new el,E[X]=nt),nt.getHandSpace()};function L(X){const nt=b.indexOf(X.inputSource);if(nt===-1)return;const et=E[nt];et!==void 0&&(et.update(X.inputSource,X.frame,h||a),et.dispatchEvent({type:X.type,data:X.inputSource}))}function N(){n.removeEventListener("select",L),n.removeEventListener("selectstart",L),n.removeEventListener("selectend",L),n.removeEventListener("squeeze",L),n.removeEventListener("squeezestart",L),n.removeEventListener("squeezeend",L),n.removeEventListener("end",N),n.removeEventListener("inputsourceschange",D);for(let X=0;X<E.length;X++){const nt=b[X];nt!==null&&(b[X]=null,E[X].disconnect(nt))}z=null,G=null,m.reset();for(const X in g)delete g[X];t.setRenderTarget(S),f=null,u=null,d=null,n=null,_=null,_t.stop(),i.isPresenting=!1,t.setPixelRatio(y),t.setSize(A.width,A.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(X){s=X,i.isPresenting===!0&&Nt("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(X){o=X,i.isPresenting===!0&&Nt("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return h||a},this.setReferenceSpace=function(X){h=X},this.getBaseLayer=function(){return u!==null?u:f},this.getBinding=function(){return d===null&&x&&(d=new XRWebGLBinding(n,e)),d},this.getFrame=function(){return p},this.getSession=function(){return n},this.setSession=async function(X){if(n=X,n!==null){if(S=t.getRenderTarget(),n.addEventListener("select",L),n.addEventListener("selectstart",L),n.addEventListener("selectend",L),n.addEventListener("squeeze",L),n.addEventListener("squeezestart",L),n.addEventListener("squeezeend",L),n.addEventListener("end",N),n.addEventListener("inputsourceschange",D),v.xrCompatible!==!0&&await e.makeXRCompatible(),y=t.getPixelRatio(),t.getSize(A),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let et=null,Rt=null,Dt=null;v.depth&&(Dt=v.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,et=v.stencil?ns:ln,Rt=v.stencil?ra:Gi);const yt={colorFormat:e.RGBA8,depthFormat:Dt,scaleFactor:s};d=this.getBinding(),u=d.createProjectionLayer(yt),n.updateRenderState({layers:[u]}),t.setPixelRatio(1),t.setSize(u.textureWidth,u.textureHeight,!1),_=new Bi(u.textureWidth,u.textureHeight,{format:Ti,type:ui,depthTexture:new pr(u.textureWidth,u.textureHeight,Rt,void 0,void 0,void 0,void 0,void 0,void 0,et),stencilBuffer:v.stencil,colorSpace:t.outputColorSpace,samples:v.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1})}else{const et={antialias:v.antialias,alpha:!0,depth:v.depth,stencil:v.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(n,e,et),n.updateRenderState({baseLayer:f}),t.setPixelRatio(1),t.setSize(f.framebufferWidth,f.framebufferHeight,!1),_=new Bi(f.framebufferWidth,f.framebufferHeight,{format:Ti,type:ui,colorSpace:t.outputColorSpace,stencilBuffer:v.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}_.isXRRenderTarget=!0,this.setFoveation(l),h=null,a=await n.requestReferenceSpace(o),_t.setContext(n),_t.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(n!==null)return n.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function D(X){for(let nt=0;nt<X.removed.length;nt++){const et=X.removed[nt],Rt=b.indexOf(et);Rt>=0&&(b[Rt]=null,E[Rt].disconnect(et))}for(let nt=0;nt<X.added.length;nt++){const et=X.added[nt];let Rt=b.indexOf(et);if(Rt===-1){for(let yt=0;yt<E.length;yt++)if(yt>=b.length){b.push(et),Rt=yt;break}else if(b[yt]===null){b[yt]=et,Rt=yt;break}if(Rt===-1)break}const Dt=E[Rt];Dt&&Dt.connect(et)}}const $=new B,Q=new B;function st(X,nt,et){$.setFromMatrixPosition(nt.matrixWorld),Q.setFromMatrixPosition(et.matrixWorld);const Rt=$.distanceTo(Q),Dt=nt.projectionMatrix.elements,yt=et.projectionMatrix.elements,te=Dt[14]/(Dt[10]-1),St=Dt[14]/(Dt[10]+1),Ft=(Dt[9]+1)/Dt[5],kt=(Dt[9]-1)/Dt[5],Ot=(Dt[8]-1)/Dt[0],se=(yt[8]+1)/yt[0],me=te*Ot,xe=te*se,be=Rt/(-Ot+se),ye=be*-Ot;if(nt.matrixWorld.decompose(X.position,X.quaternion,X.scale),X.translateX(ye),X.translateZ(be),X.matrixWorld.compose(X.position,X.quaternion,X.scale),X.matrixWorldInverse.copy(X.matrixWorld).invert(),Dt[10]===-1)X.projectionMatrix.copy(nt.projectionMatrix),X.projectionMatrixInverse.copy(nt.projectionMatrixInverse);else{const Ae=te+be,O=St+be,Qe=me-ye,ee=xe+(Rt-ye),P=Ft*St/O*Ae,M=kt*St/O*Ae;X.projectionMatrix.makePerspective(Qe,ee,P,M,Ae,O),X.projectionMatrixInverse.copy(X.projectionMatrix).invert()}}function rt(X,nt){nt===null?X.matrixWorld.copy(X.matrix):X.matrixWorld.multiplyMatrices(nt.matrixWorld,X.matrix),X.matrixWorldInverse.copy(X.matrixWorld).invert()}this.updateCamera=function(X){if(n===null)return;let nt=X.near,et=X.far;m.texture!==null&&(m.depthNear>0&&(nt=m.depthNear),m.depthFar>0&&(et=m.depthFar)),I.near=C.near=w.near=nt,I.far=C.far=w.far=et,(z!==I.near||G!==I.far)&&(n.updateRenderState({depthNear:I.near,depthFar:I.far}),z=I.near,G=I.far),I.layers.mask=X.layers.mask|6,w.layers.mask=I.layers.mask&-5,C.layers.mask=I.layers.mask&-3;const Rt=X.parent,Dt=I.cameras;rt(I,Rt);for(let yt=0;yt<Dt.length;yt++)rt(Dt[yt],Rt);Dt.length===2?st(I,w,C):I.projectionMatrix.copy(w.projectionMatrix),U(X,I,Rt)};function U(X,nt,et){et===null?X.matrix.copy(nt.matrixWorld):(X.matrix.copy(et.matrixWorld),X.matrix.invert(),X.matrix.multiply(nt.matrixWorld)),X.matrix.decompose(X.position,X.quaternion,X.scale),X.updateMatrixWorld(!0),X.projectionMatrix.copy(nt.projectionMatrix),X.projectionMatrixInverse.copy(nt.projectionMatrixInverse),X.isPerspectiveCamera&&(X.fov=oa*2*Math.atan(1/X.projectionMatrix.elements[5]),X.zoom=1)}this.getCamera=function(){return I},this.getFoveation=function(){if(!(u===null&&f===null))return l},this.setFoveation=function(X){l=X,u!==null&&(u.fixedFoveation=X),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=X)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(I)},this.getCameraTexture=function(X){return g[X]};let at=null;function bt(X,nt){if(c=nt.getViewerPose(h||a),p=nt,c!==null){const et=c.views;f!==null&&(t.setRenderTargetFramebuffer(_,f.framebuffer),t.setRenderTarget(_));let Rt=!1;et.length!==I.cameras.length&&(I.cameras.length=0,Rt=!0);for(let St=0;St<et.length;St++){const Ft=et[St];let kt=null;if(f!==null)kt=f.getViewport(Ft);else{const se=d.getViewSubImage(u,Ft);kt=se.viewport,St===0&&(t.setRenderTargetTextures(_,se.colorTexture,se.depthStencilTexture),t.setRenderTarget(_))}let Ot=R[St];Ot===void 0&&(Ot=new hi,Ot.layers.enable(St),Ot.viewport=new Te,R[St]=Ot),Ot.matrix.fromArray(Ft.transform.matrix),Ot.matrix.decompose(Ot.position,Ot.quaternion,Ot.scale),Ot.projectionMatrix.fromArray(Ft.projectionMatrix),Ot.projectionMatrixInverse.copy(Ot.projectionMatrix).invert(),Ot.viewport.set(kt.x,kt.y,kt.width,kt.height),St===0&&(I.matrix.copy(Ot.matrix),I.matrix.decompose(I.position,I.quaternion,I.scale)),Rt===!0&&I.cameras.push(Ot)}const Dt=n.enabledFeatures;if(Dt&&Dt.includes("depth-sensing")&&n.depthUsage=="gpu-optimized"&&x){d=i.getBinding();const St=d.getDepthInformation(et[0]);St&&St.isValid&&St.texture&&m.init(St,n.renderState)}if(Dt&&Dt.includes("camera-access")&&x){t.state.unbindTexture(),d=i.getBinding();for(let St=0;St<et.length;St++){const Ft=et[St].camera;if(Ft){let kt=g[Ft];kt||(kt=new Hf,g[Ft]=kt);const Ot=d.getCameraImage(Ft);kt.sourceTexture=Ot}}}}for(let et=0;et<E.length;et++){const Rt=b[et],Dt=E[et];Rt!==null&&Dt!==void 0&&Dt.update(Rt,nt,h||a)}at&&at(X,nt),nt.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:nt}),p=null}const _t=new Qf;_t.setAnimationLoop(bt),this.setAnimationLoop=function(X){at=X},this.dispose=function(){}}}const dv=new pe,rp=new Gt;rp.set(-1,0,0,0,1,0,0,0,1);function fv(r,t){function e(m,g){m.matrixAutoUpdate===!0&&m.updateMatrix(),g.value.copy(m.matrix)}function i(m,g){g.color.getRGB(m.fogColor.value,$f(r)),g.isFog?(m.fogNear.value=g.near,m.fogFar.value=g.far):g.isFogExp2&&(m.fogDensity.value=g.density)}function n(m,g,v,S,_){g.isNodeMaterial?g.uniformsNeedUpdate=!1:g.isMeshBasicMaterial?s(m,g):g.isMeshLambertMaterial?(s(m,g),g.envMap&&(m.envMapIntensity.value=g.envMapIntensity)):g.isMeshToonMaterial?(s(m,g),d(m,g)):g.isMeshPhongMaterial?(s(m,g),c(m,g),g.envMap&&(m.envMapIntensity.value=g.envMapIntensity)):g.isMeshStandardMaterial?(s(m,g),u(m,g),g.isMeshPhysicalMaterial&&f(m,g,_)):g.isMeshMatcapMaterial?(s(m,g),p(m,g)):g.isMeshDepthMaterial?s(m,g):g.isMeshDistanceMaterial?(s(m,g),x(m,g)):g.isMeshNormalMaterial?s(m,g):g.isLineBasicMaterial?(a(m,g),g.isLineDashedMaterial&&o(m,g)):g.isPointsMaterial?l(m,g,v,S):g.isSpriteMaterial?h(m,g):g.isShadowMaterial?(m.color.value.copy(g.color),m.opacity.value=g.opacity):g.isShaderMaterial&&(g.uniformsNeedUpdate=!1)}function s(m,g){m.opacity.value=g.opacity,g.color&&m.diffuse.value.copy(g.color),g.emissive&&m.emissive.value.copy(g.emissive).multiplyScalar(g.emissiveIntensity),g.map&&(m.map.value=g.map,e(g.map,m.mapTransform)),g.alphaMap&&(m.alphaMap.value=g.alphaMap,e(g.alphaMap,m.alphaMapTransform)),g.bumpMap&&(m.bumpMap.value=g.bumpMap,e(g.bumpMap,m.bumpMapTransform),m.bumpScale.value=g.bumpScale,g.side===Be&&(m.bumpScale.value*=-1)),g.normalMap&&(m.normalMap.value=g.normalMap,e(g.normalMap,m.normalMapTransform),m.normalScale.value.copy(g.normalScale),g.side===Be&&m.normalScale.value.negate()),g.displacementMap&&(m.displacementMap.value=g.displacementMap,e(g.displacementMap,m.displacementMapTransform),m.displacementScale.value=g.displacementScale,m.displacementBias.value=g.displacementBias),g.emissiveMap&&(m.emissiveMap.value=g.emissiveMap,e(g.emissiveMap,m.emissiveMapTransform)),g.specularMap&&(m.specularMap.value=g.specularMap,e(g.specularMap,m.specularMapTransform)),g.alphaTest>0&&(m.alphaTest.value=g.alphaTest);const v=t.get(g),S=v.envMap,_=v.envMapRotation;S&&(m.envMap.value=S,m.envMapRotation.value.setFromMatrix4(dv.makeRotationFromEuler(_)).transpose(),S.isCubeTexture&&S.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(rp),m.reflectivity.value=g.reflectivity,m.ior.value=g.ior,m.refractionRatio.value=g.refractionRatio),g.lightMap&&(m.lightMap.value=g.lightMap,m.lightMapIntensity.value=g.lightMapIntensity,e(g.lightMap,m.lightMapTransform)),g.aoMap&&(m.aoMap.value=g.aoMap,m.aoMapIntensity.value=g.aoMapIntensity,e(g.aoMap,m.aoMapTransform))}function a(m,g){m.diffuse.value.copy(g.color),m.opacity.value=g.opacity,g.map&&(m.map.value=g.map,e(g.map,m.mapTransform))}function o(m,g){m.dashSize.value=g.dashSize,m.totalSize.value=g.dashSize+g.gapSize,m.scale.value=g.scale}function l(m,g,v,S){m.diffuse.value.copy(g.color),m.opacity.value=g.opacity,m.size.value=g.size*v,m.scale.value=S*.5,g.map&&(m.map.value=g.map,e(g.map,m.uvTransform)),g.alphaMap&&(m.alphaMap.value=g.alphaMap,e(g.alphaMap,m.alphaMapTransform)),g.alphaTest>0&&(m.alphaTest.value=g.alphaTest)}function h(m,g){m.diffuse.value.copy(g.color),m.opacity.value=g.opacity,m.rotation.value=g.rotation,g.map&&(m.map.value=g.map,e(g.map,m.mapTransform)),g.alphaMap&&(m.alphaMap.value=g.alphaMap,e(g.alphaMap,m.alphaMapTransform)),g.alphaTest>0&&(m.alphaTest.value=g.alphaTest)}function c(m,g){m.specular.value.copy(g.specular),m.shininess.value=Math.max(g.shininess,1e-4)}function d(m,g){g.gradientMap&&(m.gradientMap.value=g.gradientMap)}function u(m,g){m.metalness.value=g.metalness,g.metalnessMap&&(m.metalnessMap.value=g.metalnessMap,e(g.metalnessMap,m.metalnessMapTransform)),m.roughness.value=g.roughness,g.roughnessMap&&(m.roughnessMap.value=g.roughnessMap,e(g.roughnessMap,m.roughnessMapTransform)),g.envMap&&(m.envMapIntensity.value=g.envMapIntensity)}function f(m,g,v){m.ior.value=g.ior,g.sheen>0&&(m.sheenColor.value.copy(g.sheenColor).multiplyScalar(g.sheen),m.sheenRoughness.value=g.sheenRoughness,g.sheenColorMap&&(m.sheenColorMap.value=g.sheenColorMap,e(g.sheenColorMap,m.sheenColorMapTransform)),g.sheenRoughnessMap&&(m.sheenRoughnessMap.value=g.sheenRoughnessMap,e(g.sheenRoughnessMap,m.sheenRoughnessMapTransform))),g.clearcoat>0&&(m.clearcoat.value=g.clearcoat,m.clearcoatRoughness.value=g.clearcoatRoughness,g.clearcoatMap&&(m.clearcoatMap.value=g.clearcoatMap,e(g.clearcoatMap,m.clearcoatMapTransform)),g.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=g.clearcoatRoughnessMap,e(g.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),g.clearcoatNormalMap&&(m.clearcoatNormalMap.value=g.clearcoatNormalMap,e(g.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(g.clearcoatNormalScale),g.side===Be&&m.clearcoatNormalScale.value.negate())),g.dispersion>0&&(m.dispersion.value=g.dispersion),g.iridescence>0&&(m.iridescence.value=g.iridescence,m.iridescenceIOR.value=g.iridescenceIOR,m.iridescenceThicknessMinimum.value=g.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=g.iridescenceThicknessRange[1],g.iridescenceMap&&(m.iridescenceMap.value=g.iridescenceMap,e(g.iridescenceMap,m.iridescenceMapTransform)),g.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=g.iridescenceThicknessMap,e(g.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),g.transmission>0&&(m.transmission.value=g.transmission,m.transmissionSamplerMap.value=v.texture,m.transmissionSamplerSize.value.set(v.width,v.height),g.transmissionMap&&(m.transmissionMap.value=g.transmissionMap,e(g.transmissionMap,m.transmissionMapTransform)),m.thickness.value=g.thickness,g.thicknessMap&&(m.thicknessMap.value=g.thicknessMap,e(g.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=g.attenuationDistance,m.attenuationColor.value.copy(g.attenuationColor)),g.anisotropy>0&&(m.anisotropyVector.value.set(g.anisotropy*Math.cos(g.anisotropyRotation),g.anisotropy*Math.sin(g.anisotropyRotation)),g.anisotropyMap&&(m.anisotropyMap.value=g.anisotropyMap,e(g.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=g.specularIntensity,m.specularColor.value.copy(g.specularColor),g.specularColorMap&&(m.specularColorMap.value=g.specularColorMap,e(g.specularColorMap,m.specularColorMapTransform)),g.specularIntensityMap&&(m.specularIntensityMap.value=g.specularIntensityMap,e(g.specularIntensityMap,m.specularIntensityMapTransform))}function p(m,g){g.matcap&&(m.matcap.value=g.matcap)}function x(m,g){const v=t.get(g).light;m.referencePosition.value.setFromMatrixPosition(v.matrixWorld),m.nearDistance.value=v.shadow.camera.near,m.farDistance.value=v.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:n}}function pv(r,t,e,i){let n={},s={},a=[];const o=r.getParameter(r.MAX_UNIFORM_BUFFER_BINDINGS);function l(_,E){const b=E.program;i.uniformBlockBinding(_,b)}function h(_,E){let b=n[_.id];b===void 0&&(m(_),b=c(_),n[_.id]=b,_.addEventListener("dispose",v));const A=E.program;i.updateUBOMapping(_,A);const y=t.render.frame;s[_.id]!==y&&(u(_),s[_.id]=y)}function c(_){const E=d();_.__bindingPointIndex=E;const b=r.createBuffer(),A=_.__size,y=_.usage;return r.bindBuffer(r.UNIFORM_BUFFER,b),r.bufferData(r.UNIFORM_BUFFER,A,y),r.bindBuffer(r.UNIFORM_BUFFER,null),r.bindBufferBase(r.UNIFORM_BUFFER,E,b),b}function d(){for(let _=0;_<o;_++)if(a.indexOf(_)===-1)return a.push(_),_;return Qt("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(_){const E=n[_.id],b=_.uniforms,A=_.__cache;r.bindBuffer(r.UNIFORM_BUFFER,E);for(let y=0,w=b.length;y<w;y++){const C=b[y];if(Array.isArray(C))for(let R=0,I=C.length;R<I;R++)f(C[R],y,R,A);else f(C,y,0,A)}r.bindBuffer(r.UNIFORM_BUFFER,null)}function f(_,E,b,A){if(x(_,E,b,A)===!0){const y=_.__offset,w=_.value;if(Array.isArray(w)){let C=0;for(let R=0;R<w.length;R++){const I=w[R],z=g(I);p(I,_.__data,C),typeof I!="number"&&typeof I!="boolean"&&!I.isMatrix3&&!ArrayBuffer.isView(I)&&(C+=z.storage/Float32Array.BYTES_PER_ELEMENT)}}else p(w,_.__data,0);r.bufferSubData(r.UNIFORM_BUFFER,y,_.__data)}}function p(_,E,b){typeof _=="number"||typeof _=="boolean"?E[0]=_:_.isMatrix3?(E[0]=_.elements[0],E[1]=_.elements[1],E[2]=_.elements[2],E[3]=0,E[4]=_.elements[3],E[5]=_.elements[4],E[6]=_.elements[5],E[7]=0,E[8]=_.elements[6],E[9]=_.elements[7],E[10]=_.elements[8],E[11]=0):ArrayBuffer.isView(_)?E.set(new _.constructor(_.buffer,_.byteOffset,E.length)):_.toArray(E,b)}function x(_,E,b,A){const y=_.value,w=E+"_"+b;if(A[w]===void 0)return typeof y=="number"||typeof y=="boolean"?A[w]=y:ArrayBuffer.isView(y)?A[w]=y.slice():A[w]=y.clone(),!0;{const C=A[w];if(typeof y=="number"||typeof y=="boolean"){if(C!==y)return A[w]=y,!0}else{if(ArrayBuffer.isView(y))return!0;if(C.equals(y)===!1)return C.copy(y),!0}}return!1}function m(_){const E=_.uniforms;let b=0;const A=16;for(let w=0,C=E.length;w<C;w++){const R=Array.isArray(E[w])?E[w]:[E[w]];for(let I=0,z=R.length;I<z;I++){const G=R[I],L=Array.isArray(G.value)?G.value:[G.value];for(let N=0,D=L.length;N<D;N++){const $=L[N],Q=g($),st=b%A,rt=st%Q.boundary,U=st+rt;b+=rt,U!==0&&A-U<Q.storage&&(b+=A-U),G.__data=new Float32Array(Q.storage/Float32Array.BYTES_PER_ELEMENT),G.__offset=b,b+=Q.storage}}}const y=b%A;return y>0&&(b+=A-y),_.__size=b,_.__cache={},this}function g(_){const E={boundary:0,storage:0};return typeof _=="number"||typeof _=="boolean"?(E.boundary=4,E.storage=4):_.isVector2?(E.boundary=8,E.storage=8):_.isVector3||_.isColor?(E.boundary=16,E.storage=12):_.isVector4?(E.boundary=16,E.storage=16):_.isMatrix3?(E.boundary=48,E.storage=48):_.isMatrix4?(E.boundary=64,E.storage=64):_.isTexture?Nt("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(_)?(E.boundary=16,E.storage=_.byteLength):Nt("WebGLRenderer: Unsupported uniform value type.",_),E}function v(_){const E=_.target;E.removeEventListener("dispose",v);const b=a.indexOf(E.__bindingPointIndex);a.splice(b,1),r.deleteBuffer(n[E.id]),delete n[E.id],delete s[E.id]}function S(){for(const _ in n)r.deleteBuffer(n[_]);a=[],n={},s={}}return{bind:l,update:h,dispose:S}}const mv=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]);let Fi=null;function gv(){return Fi===null&&(Fi=new Vf(mv,16,16,rs,on),Fi.name="DFG_LUT",Fi.minFilter=qe,Fi.magFilter=qe,Fi.wrapS=nn,Fi.wrapT=nn,Fi.generateMipmaps=!1,Fi.needsUpdate=!0),Fi}class xv{constructor(t={}){const{canvas:e=xm(),context:i=null,depth:n=!0,stencil:s=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:h=!1,powerPreference:c="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:u=!1,outputBufferType:f=ui}=t;this.isWebGLRenderer=!0;let p;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=i.getContextAttributes().alpha}else p=a;const x=f,m=new Set([xc,gc,mc]),g=new Set([ui,Gi,sa,ra,dc,fc]),v=new Uint32Array(4),S=new Int32Array(4),_=new B;let E=null,b=null;const A=[],y=[];let w=null;this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Ai,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const C=this;let R=!1,I=null,z=null,G=null,L=null;this._outputColorSpace=oi;let N=0,D=0,$=null,Q=-1,st=null;const rt=new Te,U=new Te;let at=null;const bt=new zt(0);let _t=0,X=e.width,nt=e.height,et=1,Rt=null,Dt=null;const yt=new Te(0,0,X,nt),te=new Te(0,0,X,nt);let St=!1;const Ft=new Tc;let kt=!1,Ot=!1;const se=new pe,me=new B,xe=new Te,be={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let ye=!1;function Ae(){return $===null?et:1}let O=i;function Qe(T,k){return e.getContext(T,k)}try{const T={alpha:!0,depth:n,stencil:s,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:h,powerPreference:c,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${sc}`),e.addEventListener("webglcontextlost",_e,!1),e.addEventListener("webglcontextrestored",ce,!1),e.addEventListener("webglcontextcreationerror",Ii,!1),O===null){const k="webgl2";if(O=Qe(k,T),O===null)throw Qe(k)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}}catch(T){throw Qt("WebGLRenderer: "+T.message),T}let ee,P,M,V,q,K,ot,ht,J,tt,ct,At,ft,ut,It,Lt,Bt,F,lt,j,dt,xt,it;function Tt(){ee=new gy(O),ee.init(),dt=new ov(O,ee),P=new ly(O,ee,t,dt),M=new rv(O,ee),P.reversedDepthBuffer&&u&&M.buffers.depth.setReversed(!0),z=O.createFramebuffer(),G=O.createFramebuffer(),L=O.createFramebuffer(),V=new _y(O),q=new X_,K=new av(O,ee,M,q,P,dt,V),ot=new my(C),ht=new S0(O),xt=new ay(O,ht),J=new xy(O,ht,V,xt),tt=new My(O,J,ht,xt,V),F=new vy(O,P,K),It=new hy(q),ct=new W_(C,ot,ee,P,xt,It),At=new fv(C,q),ft=new $_,ut=new j_(ee),Bt=new ry(C,ot,M,tt,p,l),Lt=new sv(C,tt,P),it=new pv(O,V,P,M),lt=new oy(O,ee,V),j=new yy(O,ee,V),V.programs=ct.programs,C.capabilities=P,C.extensions=ee,C.properties=q,C.renderLists=ft,C.shadowMap=Lt,C.state=M,C.info=V}Tt(),x!==ui&&(w=new Sy(x,e.width,e.height,o,n,s));const wt=new uv(C,O);this.xr=wt,this.getContext=function(){return O},this.getContextAttributes=function(){return O.getContextAttributes()},this.forceContextLoss=function(){const T=ee.get("WEBGL_lose_context");T&&T.loseContext()},this.forceContextRestore=function(){const T=ee.get("WEBGL_lose_context");T&&T.restoreContext()},this.getPixelRatio=function(){return et},this.setPixelRatio=function(T){T!==void 0&&(et=T,this.setSize(X,nt,!1))},this.getSize=function(T){return T.set(X,nt)},this.setSize=function(T,k,Y=!0){if(wt.isPresenting){Nt("WebGLRenderer: Can't change size while VR device is presenting.");return}X=T,nt=k,e.width=Math.floor(T*et),e.height=Math.floor(k*et),Y===!0&&(e.style.width=T+"px",e.style.height=k+"px"),w!==null&&w.setSize(e.width,e.height),this.setViewport(0,0,T,k)},this.getDrawingBufferSize=function(T){return T.set(X*et,nt*et).floor()},this.setDrawingBufferSize=function(T,k,Y){X=T,nt=k,et=Y,e.width=Math.floor(T*Y),e.height=Math.floor(k*Y),this.setViewport(0,0,T,k)},this.setEffects=function(T){if(x===ui){Qt("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(T){for(let k=0;k<T.length;k++)if(T[k].isOutputPass===!0){Nt("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}w.setEffects(T||[])},this.getCurrentViewport=function(T){return T.copy(rt)},this.getViewport=function(T){return T.copy(yt)},this.setViewport=function(T,k,Y,H){T.isVector4?yt.set(T.x,T.y,T.z,T.w):yt.set(T,k,Y,H),M.viewport(rt.copy(yt).multiplyScalar(et).round())},this.getScissor=function(T){return T.copy(te)},this.setScissor=function(T,k,Y,H){T.isVector4?te.set(T.x,T.y,T.z,T.w):te.set(T,k,Y,H),M.scissor(U.copy(te).multiplyScalar(et).round())},this.getScissorTest=function(){return St},this.setScissorTest=function(T){M.setScissorTest(St=T)},this.setOpaqueSort=function(T){Rt=T},this.setTransparentSort=function(T){Dt=T},this.getClearColor=function(T){return T.copy(Bt.getClearColor())},this.setClearColor=function(){Bt.setClearColor(...arguments)},this.getClearAlpha=function(){return Bt.getClearAlpha()},this.setClearAlpha=function(){Bt.setClearAlpha(...arguments)},this.clear=function(T=!0,k=!0,Y=!0){let H=0;if(T){let W=!1;if($!==null){const gt=$.texture.format;W=m.has(gt)}if(W){const gt=$.texture.type,Mt=g.has(gt),mt=Bt.getClearColor(),Et=Bt.getClearAlpha(),Ct=mt.r,Vt=mt.g,qt=mt.b;Mt?(v[0]=Ct,v[1]=Vt,v[2]=qt,v[3]=Et,O.clearBufferuiv(O.COLOR,0,v)):(S[0]=Ct,S[1]=Vt,S[2]=qt,S[3]=Et,O.clearBufferiv(O.COLOR,0,S))}else H|=O.COLOR_BUFFER_BIT}k&&(H|=O.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),Y&&(H|=O.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),H!==0&&O.clear(H)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(T){T.setRenderer(this),I=T},this.dispose=function(){e.removeEventListener("webglcontextlost",_e,!1),e.removeEventListener("webglcontextrestored",ce,!1),e.removeEventListener("webglcontextcreationerror",Ii,!1),Bt.dispose(),ft.dispose(),ut.dispose(),q.dispose(),ot.dispose(),tt.dispose(),xt.dispose(),it.dispose(),ct.dispose(),wt.dispose(),wt.removeEventListener("sessionstart",zc),wt.removeEventListener("sessionend",Oc),Hn.stop()};function _e(T){T.preventDefault(),tu("WebGLRenderer: Context Lost."),R=!0}function ce(){tu("WebGLRenderer: Context Restored."),R=!1;const T=V.autoReset,k=Lt.enabled,Y=Lt.autoUpdate,H=Lt.needsUpdate,W=Lt.type;Tt(),V.autoReset=T,Lt.enabled=k,Lt.autoUpdate=Y,Lt.needsUpdate=H,Lt.type=W}function Ii(T){Qt("WebGLRenderer: A WebGL context could not be created. Reason: ",T.statusMessage)}function Di(T){const k=T.target;k.removeEventListener("dispose",Di),Rp(k)}function Rp(T){Pp(T),q.remove(T)}function Pp(T){const k=q.get(T).programs;k!==void 0&&(k.forEach(function(Y){ct.releaseProgram(Y)}),T.isShaderMaterial&&ct.releaseShaderCache(T))}this.renderBufferDirect=function(T,k,Y,H,W,gt){k===null&&(k=be);const Mt=W.isMesh&&W.matrixWorld.determinantAffine()<0,mt=Lp(T,k,Y,H,W);M.setMaterial(H,Mt);let Et=Y.index,Ct=1;if(H.wireframe===!0){if(Et=J.getWireframeAttribute(Y),Et===void 0)return;Ct=2}const Vt=Y.drawRange,qt=Y.attributes.position;let Pt=Vt.start*Ct,re=(Vt.start+Vt.count)*Ct;gt!==null&&(Pt=Math.max(Pt,gt.start*Ct),re=Math.min(re,(gt.start+gt.count)*Ct)),Et!==null?(Pt=Math.max(Pt,0),re=Math.min(re,Et.count)):qt!=null&&(Pt=Math.max(Pt,0),re=Math.min(re,qt.count));const Se=re-Pt;if(Se<0||Se===1/0)return;xt.setup(W,H,mt,Y,Et);let ve,le=lt;if(Et!==null&&(ve=ht.get(Et),le=j,le.setIndex(ve)),W.isMesh)H.wireframe===!0?(M.setLineWidth(H.wireframeLinewidth*Ae()),le.setMode(O.LINES)):le.setMode(O.TRIANGLES);else if(W.isLine){let Ve=H.linewidth;Ve===void 0&&(Ve=1),M.setLineWidth(Ve*Ae()),W.isLineSegments?le.setMode(O.LINES):W.isLineLoop?le.setMode(O.LINE_LOOP):le.setMode(O.LINE_STRIP)}else W.isPoints?le.setMode(O.POINTS):W.isSprite&&le.setMode(O.TRIANGLES);if(W.isBatchedMesh)if(ee.get("WEBGL_multi_draw"))le.renderMultiDraw(W._multiDrawStarts,W._multiDrawCounts,W._multiDrawCount);else{const Ve=W._multiDrawStarts,vt=W._multiDrawCounts,ii=W._multiDrawCount,jt=Et?ht.get(Et).bytesPerElement:1,di=q.get(H).currentProgram.getUniforms();for(let Li=0;Li<ii;Li++)di.setValue(O,"_gl_DrawID",Li),le.render(Ve[Li]/jt,vt[Li])}else if(W.isInstancedMesh)le.renderInstances(Pt,Se,W.count);else if(Y.isInstancedBufferGeometry){const Ve=Y._maxInstanceCount!==void 0?Y._maxInstanceCount:1/0,vt=Math.min(Y.instanceCount,Ve);le.renderInstances(Pt,Se,vt)}else le.render(Pt,Se)};function Uc(T,k,Y){T.transparent===!0&&T.side===en&&T.forceSinglePass===!1?(T.side=Be,T.needsUpdate=!0,fa(T,k,Y),T.side=Fn,T.needsUpdate=!0,fa(T,k,Y),T.side=en):fa(T,k,Y)}this.compile=function(T,k,Y=null){Y===null&&(Y=T),b=ut.get(Y),b.init(k),y.push(b),Y.traverseVisible(function(W){W.isLight&&W.layers.test(k.layers)&&(b.pushLight(W),W.castShadow&&b.pushShadow(W))}),T!==Y&&T.traverseVisible(function(W){W.isLight&&W.layers.test(k.layers)&&(b.pushLight(W),W.castShadow&&b.pushShadow(W))}),b.setupLights();const H=new Set;return T.traverse(function(W){if(!(W.isMesh||W.isPoints||W.isLine||W.isSprite))return;const gt=W.material;if(gt)if(Array.isArray(gt))for(let Mt=0;Mt<gt.length;Mt++){const mt=gt[Mt];Uc(mt,Y,W),H.add(mt)}else Uc(gt,Y,W),H.add(gt)}),b=y.pop(),H},this.compileAsync=function(T,k,Y=null){const H=this.compile(T,k,Y);return new Promise(W=>{function gt(){if(H.forEach(function(Mt){q.get(Mt).currentProgram.isReady()&&H.delete(Mt)}),H.size===0){W(T);return}setTimeout(gt,10)}ee.get("KHR_parallel_shader_compile")!==null?gt():setTimeout(gt,10)})};let qo=null;function Ip(T){qo&&qo(T)}function zc(){Hn.stop()}function Oc(){Hn.start()}const Hn=new Qf;Hn.setAnimationLoop(Ip),typeof self<"u"&&Hn.setContext(self),this.setAnimationLoop=function(T){qo=T,wt.setAnimationLoop(T),T===null?Hn.stop():Hn.start()},wt.addEventListener("sessionstart",zc),wt.addEventListener("sessionend",Oc),this.render=function(T,k){if(k!==void 0&&k.isCamera!==!0){Qt("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(R===!0)return;I!==null&&I.renderStart(T,k);const Y=wt.enabled===!0&&wt.isPresenting===!0,H=w!==null&&($===null||Y)&&w.begin(C,$);if(T.matrixWorldAutoUpdate===!0&&T.updateMatrixWorld(),k.parent===null&&k.matrixWorldAutoUpdate===!0&&k.updateMatrixWorld(),wt.enabled===!0&&wt.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(wt.cameraAutoUpdate===!0&&wt.updateCamera(k),k=wt.getCamera()),T.isScene===!0&&T.onBeforeRender(C,T,k,$),b=ut.get(T,y.length),b.init(k),b.state.textureUnits=K.getTextureUnits(),y.push(b),se.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),Ft.setFromProjectionMatrix(se,ki,k.reversedDepth),Ot=this.localClippingEnabled,kt=It.init(this.clippingPlanes,Ot),E=ft.get(T,A.length),E.init(),A.push(E),wt.enabled===!0&&wt.isPresenting===!0){const Mt=C.xr.getDepthSensingMesh();Mt!==null&&$o(Mt,k,-1/0,C.sortObjects)}$o(T,k,0,C.sortObjects),E.finish(),C.sortObjects===!0&&E.sort(Rt,Dt,k.reversedDepth),ye=wt.enabled===!1||wt.isPresenting===!1||wt.hasDepthSensing()===!1,ye&&Bt.addToRenderList(E,T),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),kt===!0&&It.beginShadows();const W=b.state.shadowsArray;if(Lt.render(W,T,k),kt===!0&&It.endShadows(),(H&&w.hasRenderPass())===!1){const Mt=E.opaque,mt=E.transmissive;if(b.setupLights(),k.isArrayCamera){const Et=k.cameras;if(mt.length>0)for(let Ct=0,Vt=Et.length;Ct<Vt;Ct++){const qt=Et[Ct];Bc(Mt,mt,T,qt)}ye&&Bt.render(T);for(let Ct=0,Vt=Et.length;Ct<Vt;Ct++){const qt=Et[Ct];kc(E,T,qt,qt.viewport)}}else mt.length>0&&Bc(Mt,mt,T,k),ye&&Bt.render(T),kc(E,T,k)}$!==null&&D===0&&(K.updateMultisampleRenderTarget($),K.updateRenderTargetMipmap($)),H&&w.end(C),T.isScene===!0&&T.onAfterRender(C,T,k),xt.resetDefaultState(),Q=-1,st=null,y.pop(),y.length>0?(b=y[y.length-1],K.setTextureUnits(b.state.textureUnits),kt===!0&&It.setGlobalState(C.clippingPlanes,b.state.camera)):b=null,A.pop(),A.length>0?E=A[A.length-1]:E=null,I!==null&&I.renderEnd()};function $o(T,k,Y,H){if(T.visible===!1)return;if(T.layers.test(k.layers)){if(T.isGroup)Y=T.renderOrder;else if(T.isLOD)T.autoUpdate===!0&&T.update(k);else if(T.isLightProbeGrid)b.pushLightProbeGrid(T);else if(T.isLight)b.pushLight(T),T.castShadow&&b.pushShadow(T);else if(T.isSprite){if(!T.frustumCulled||Ft.intersectsSprite(T)){H&&xe.setFromMatrixPosition(T.matrixWorld).applyMatrix4(se);const Mt=tt.update(T),mt=T.material;mt.visible&&E.push(T,Mt,mt,Y,xe.z,null)}}else if((T.isMesh||T.isLine||T.isPoints)&&(!T.frustumCulled||Ft.intersectsObject(T))){const Mt=tt.update(T),mt=T.material;if(H&&(T.boundingSphere!==void 0?(T.boundingSphere===null&&T.computeBoundingSphere(),xe.copy(T.boundingSphere.center)):(Mt.boundingSphere===null&&Mt.computeBoundingSphere(),xe.copy(Mt.boundingSphere.center)),xe.applyMatrix4(T.matrixWorld).applyMatrix4(se)),Array.isArray(mt)){const Et=Mt.groups;for(let Ct=0,Vt=Et.length;Ct<Vt;Ct++){const qt=Et[Ct],Pt=mt[qt.materialIndex];Pt&&Pt.visible&&E.push(T,Mt,Pt,Y,xe.z,qt)}}else mt.visible&&E.push(T,Mt,mt,Y,xe.z,null)}}const gt=T.children;for(let Mt=0,mt=gt.length;Mt<mt;Mt++)$o(gt[Mt],k,Y,H)}function kc(T,k,Y,H){const{opaque:W,transmissive:gt,transparent:Mt}=T;b.setupLightsView(Y),kt===!0&&It.setGlobalState(C.clippingPlanes,Y),H&&M.viewport(rt.copy(H)),W.length>0&&da(W,k,Y),gt.length>0&&da(gt,k,Y),Mt.length>0&&da(Mt,k,Y),M.buffers.depth.setTest(!0),M.buffers.depth.setMask(!0),M.buffers.color.setMask(!0),M.setPolygonOffset(!1)}function Bc(T,k,Y,H){if((Y.isScene===!0?Y.overrideMaterial:null)!==null)return;if(b.state.transmissionRenderTarget[H.id]===void 0){const Pt=ee.has("EXT_color_buffer_half_float")||ee.has("EXT_color_buffer_float");b.state.transmissionRenderTarget[H.id]=new Bi(1,1,{generateMipmaps:!0,type:Pt?on:ui,minFilter:is,samples:Math.max(4,P.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Zt.workingColorSpace})}const gt=b.state.transmissionRenderTarget[H.id],Mt=H.viewport||rt;gt.setSize(Mt.z*C.transmissionResolutionScale,Mt.w*C.transmissionResolutionScale);const mt=C.getRenderTarget(),Et=C.getActiveCubeFace(),Ct=C.getActiveMipmapLevel();C.setRenderTarget(gt),C.getClearColor(bt),_t=C.getClearAlpha(),_t<1&&C.setClearColor(16777215,.5),C.clear(),ye&&Bt.render(Y);const Vt=C.toneMapping;C.toneMapping=Ai;const qt=H.viewport;if(H.viewport!==void 0&&(H.viewport=void 0),b.setupLightsView(H),kt===!0&&It.setGlobalState(C.clippingPlanes,H),da(T,Y,H),K.updateMultisampleRenderTarget(gt),K.updateRenderTargetMipmap(gt),ee.has("WEBGL_multisampled_render_to_texture")===!1){let Pt=!1;for(let re=0,Se=k.length;re<Se;re++){const ve=k[re],{object:le,geometry:Ve,material:vt,group:ii}=ve;if(vt.side===en&&le.layers.test(H.layers)){const jt=vt.side;vt.side=Be,vt.needsUpdate=!0,Vc(le,Y,H,Ve,vt,ii),vt.side=jt,vt.needsUpdate=!0,Pt=!0}}Pt===!0&&(K.updateMultisampleRenderTarget(gt),K.updateRenderTargetMipmap(gt))}C.setRenderTarget(mt,Et,Ct),C.setClearColor(bt,_t),qt!==void 0&&(H.viewport=qt),C.toneMapping=Vt}function da(T,k,Y){const H=k.isScene===!0?k.overrideMaterial:null;for(let W=0,gt=T.length;W<gt;W++){const Mt=T[W],{object:mt,geometry:Et,group:Ct}=Mt;let Vt=Mt.material;Vt.allowOverride===!0&&H!==null&&(Vt=H),mt.layers.test(Y.layers)&&Vc(mt,k,Y,Et,Vt,Ct)}}function Vc(T,k,Y,H,W,gt){T.onBeforeRender(C,k,Y,H,W,gt),T.modelViewMatrix.multiplyMatrices(Y.matrixWorldInverse,T.matrixWorld),T.normalMatrix.getNormalMatrix(T.modelViewMatrix),W.onBeforeRender(C,k,Y,H,T,gt),W.transparent===!0&&W.side===en&&W.forceSinglePass===!1?(W.side=Be,W.needsUpdate=!0,C.renderBufferDirect(Y,k,H,W,T,gt),W.side=Fn,W.needsUpdate=!0,C.renderBufferDirect(Y,k,H,W,T,gt),W.side=en):C.renderBufferDirect(Y,k,H,W,T,gt),T.onAfterRender(C,k,Y,H,W,gt)}function fa(T,k,Y){k.isScene!==!0&&(k=be);const H=q.get(T),W=b.state.lights,gt=b.state.shadowsArray,Mt=W.state.version,mt=ct.getParameters(T,W.state,gt,k,Y,b.state.lightProbeGridArray),Et=ct.getProgramCacheKey(mt);let Ct=H.programs;H.environment=T.isMeshStandardMaterial||T.isMeshLambertMaterial||T.isMeshPhongMaterial?k.environment:null,H.fog=k.fog;const Vt=T.isMeshStandardMaterial||T.isMeshLambertMaterial&&!T.envMap||T.isMeshPhongMaterial&&!T.envMap;H.envMap=ot.get(T.envMap||H.environment,Vt),H.envMapRotation=H.environment!==null&&T.envMap===null?k.environmentRotation:T.envMapRotation,Ct===void 0&&(T.addEventListener("dispose",Di),Ct=new Map,H.programs=Ct);let qt=Ct.get(Et);if(qt!==void 0){if(H.currentProgram===qt&&H.lightsStateVersion===Mt)return Hc(T,mt),qt}else mt.uniforms=ct.getUniforms(T),I!==null&&T.isNodeMaterial&&I.build(T,Y,mt),T.onBeforeCompile(mt,C),qt=ct.acquireProgram(mt,Et),Ct.set(Et,qt),H.uniforms=mt.uniforms;const Pt=H.uniforms;return(!T.isShaderMaterial&&!T.isRawShaderMaterial||T.clipping===!0)&&(Pt.clippingPlanes=It.uniform),Hc(T,mt),H.needsLights=Fp(T),H.lightsStateVersion=Mt,H.needsLights&&(Pt.ambientLightColor.value=W.state.ambient,Pt.lightProbe.value=W.state.probe,Pt.directionalLights.value=W.state.directional,Pt.directionalLightShadows.value=W.state.directionalShadow,Pt.spotLights.value=W.state.spot,Pt.spotLightShadows.value=W.state.spotShadow,Pt.rectAreaLights.value=W.state.rectArea,Pt.ltc_1.value=W.state.rectAreaLTC1,Pt.ltc_2.value=W.state.rectAreaLTC2,Pt.pointLights.value=W.state.point,Pt.pointLightShadows.value=W.state.pointShadow,Pt.hemisphereLights.value=W.state.hemi,Pt.directionalShadowMatrix.value=W.state.directionalShadowMatrix,Pt.spotLightMatrix.value=W.state.spotLightMatrix,Pt.spotLightMap.value=W.state.spotLightMap,Pt.pointShadowMatrix.value=W.state.pointShadowMatrix),H.lightProbeGrid=b.state.lightProbeGridArray.length>0,H.currentProgram=qt,H.uniformsList=null,qt}function Gc(T){if(T.uniformsList===null){const k=T.currentProgram.getUniforms();T.uniformsList=Eo.seqWithValue(k.seq,T.uniforms)}return T.uniformsList}function Hc(T,k){const Y=q.get(T);Y.outputColorSpace=k.outputColorSpace,Y.batching=k.batching,Y.batchingColor=k.batchingColor,Y.instancing=k.instancing,Y.instancingColor=k.instancingColor,Y.instancingMorph=k.instancingMorph,Y.skinning=k.skinning,Y.morphTargets=k.morphTargets,Y.morphNormals=k.morphNormals,Y.morphColors=k.morphColors,Y.morphTargetsCount=k.morphTargetsCount,Y.numClippingPlanes=k.numClippingPlanes,Y.numIntersection=k.numClipIntersection,Y.vertexAlphas=k.vertexAlphas,Y.vertexTangents=k.vertexTangents,Y.toneMapping=k.toneMapping}function Dp(T,k){if(T.length===0)return null;if(T.length===1)return T[0].texture!==null?T[0]:null;_.setFromMatrixPosition(k.matrixWorld);for(let Y=0,H=T.length;Y<H;Y++){const W=T[Y];if(W.texture!==null&&W.boundingBox.containsPoint(_))return W}return null}function Lp(T,k,Y,H,W){k.isScene!==!0&&(k=be),K.resetTextureUnits();const gt=k.fog,Mt=H.isMeshStandardMaterial||H.isMeshLambertMaterial||H.isMeshPhongMaterial?k.environment:null,mt=$===null?C.outputColorSpace:$.isXRRenderTarget===!0?$.texture.colorSpace:Zt.workingColorSpace,Et=H.isMeshStandardMaterial||H.isMeshLambertMaterial&&!H.envMap||H.isMeshPhongMaterial&&!H.envMap,Ct=ot.get(H.envMap||Mt,Et),Vt=H.vertexColors===!0&&!!Y.attributes.color&&Y.attributes.color.itemSize===4,qt=!!Y.attributes.tangent&&(!!H.normalMap||H.anisotropy>0),Pt=!!Y.morphAttributes.position,re=!!Y.morphAttributes.normal,Se=!!Y.morphAttributes.color;let ve=Ai;H.toneMapped&&($===null||$.isXRRenderTarget===!0)&&(ve=C.toneMapping);const le=Y.morphAttributes.position||Y.morphAttributes.normal||Y.morphAttributes.color,Ve=le!==void 0?le.length:0,vt=q.get(H),ii=b.state.lights;if(kt===!0&&(Ot===!0||T!==st)){const ue=T===st&&H.id===Q;It.setState(H,T,ue)}let jt=!1;H.version===vt.__version?(vt.needsLights&&vt.lightsStateVersion!==ii.state.version||vt.outputColorSpace!==mt||W.isBatchedMesh&&vt.batching===!1||!W.isBatchedMesh&&vt.batching===!0||W.isBatchedMesh&&vt.batchingColor===!0&&W.colorTexture===null||W.isBatchedMesh&&vt.batchingColor===!1&&W.colorTexture!==null||W.isInstancedMesh&&vt.instancing===!1||!W.isInstancedMesh&&vt.instancing===!0||W.isSkinnedMesh&&vt.skinning===!1||!W.isSkinnedMesh&&vt.skinning===!0||W.isInstancedMesh&&vt.instancingColor===!0&&W.instanceColor===null||W.isInstancedMesh&&vt.instancingColor===!1&&W.instanceColor!==null||W.isInstancedMesh&&vt.instancingMorph===!0&&W.morphTexture===null||W.isInstancedMesh&&vt.instancingMorph===!1&&W.morphTexture!==null||vt.envMap!==Ct||H.fog===!0&&vt.fog!==gt||vt.numClippingPlanes!==void 0&&(vt.numClippingPlanes!==It.numPlanes||vt.numIntersection!==It.numIntersection)||vt.vertexAlphas!==Vt||vt.vertexTangents!==qt||vt.morphTargets!==Pt||vt.morphNormals!==re||vt.morphColors!==Se||vt.toneMapping!==ve||vt.morphTargetsCount!==Ve||!!vt.lightProbeGrid!=b.state.lightProbeGridArray.length>0)&&(jt=!0):(jt=!0,vt.__version=H.version);let di=vt.currentProgram;jt===!0&&(di=fa(H,k,W),I&&H.isNodeMaterial&&I.onUpdateProgram(H,di,vt));let Li=!1,un=!1,us=!1;const he=di.getUniforms(),we=vt.uniforms;if(M.useProgram(di.program)&&(Li=!0,un=!0,us=!0),H.id!==Q&&(Q=H.id,un=!0),vt.needsLights){const ue=Dp(b.state.lightProbeGridArray,W);vt.lightProbeGrid!==ue&&(vt.lightProbeGrid=ue,un=!0)}if(Li||st!==T){M.buffers.depth.getReversed()&&T.reversedDepth!==!0&&(T._reversedDepth=!0,T.updateProjectionMatrix()),he.setValue(O,"projectionMatrix",T.projectionMatrix),he.setValue(O,"viewMatrix",T.matrixWorldInverse);const fn=he.map.cameraPosition;fn!==void 0&&fn.setValue(O,me.setFromMatrixPosition(T.matrixWorld)),P.logarithmicDepthBuffer&&he.setValue(O,"logDepthBufFC",2/(Math.log(T.far+1)/Math.LN2)),(H.isMeshPhongMaterial||H.isMeshToonMaterial||H.isMeshLambertMaterial||H.isMeshBasicMaterial||H.isMeshStandardMaterial||H.isShaderMaterial)&&he.setValue(O,"isOrthographic",T.isOrthographicCamera===!0),st!==T&&(st=T,un=!0,us=!0)}if(vt.needsLights&&(ii.state.directionalShadowMap.length>0&&he.setValue(O,"directionalShadowMap",ii.state.directionalShadowMap,K),ii.state.spotShadowMap.length>0&&he.setValue(O,"spotShadowMap",ii.state.spotShadowMap,K),ii.state.pointShadowMap.length>0&&he.setValue(O,"pointShadowMap",ii.state.pointShadowMap,K)),W.isSkinnedMesh){he.setOptional(O,W,"bindMatrix"),he.setOptional(O,W,"bindMatrixInverse");const ue=W.skeleton;ue&&(ue.boneTexture===null&&ue.computeBoneTexture(),he.setValue(O,"boneTexture",ue.boneTexture,K))}W.isBatchedMesh&&(he.setOptional(O,W,"batchingTexture"),he.setValue(O,"batchingTexture",W._matricesTexture,K),he.setOptional(O,W,"batchingIdTexture"),he.setValue(O,"batchingIdTexture",W._indirectTexture,K),he.setOptional(O,W,"batchingColorTexture"),W._colorsTexture!==null&&he.setValue(O,"batchingColorTexture",W._colorsTexture,K));const dn=Y.morphAttributes;if((dn.position!==void 0||dn.normal!==void 0||dn.color!==void 0)&&F.update(W,Y,di),(un||vt.receiveShadow!==W.receiveShadow)&&(vt.receiveShadow=W.receiveShadow,he.setValue(O,"receiveShadow",W.receiveShadow)),(H.isMeshStandardMaterial||H.isMeshLambertMaterial||H.isMeshPhongMaterial)&&H.envMap===null&&k.environment!==null&&(we.envMapIntensity.value=k.environmentIntensity),we.dfgLUT!==void 0&&(we.dfgLUT.value=gv()),un){if(he.setValue(O,"toneMappingExposure",C.toneMappingExposure),vt.needsLights&&Np(we,us),gt&&H.fog===!0&&At.refreshFogUniforms(we,gt),At.refreshMaterialUniforms(we,H,et,nt,b.state.transmissionRenderTarget[T.id]),vt.needsLights&&vt.lightProbeGrid){const ue=vt.lightProbeGrid;we.probesSH.value=ue.texture,we.probesMin.value.copy(ue.boundingBox.min),we.probesMax.value.copy(ue.boundingBox.max),we.probesResolution.value.copy(ue.resolution)}Eo.upload(O,Gc(vt),we,K)}if(H.isShaderMaterial&&H.uniformsNeedUpdate===!0&&(Eo.upload(O,Gc(vt),we,K),H.uniformsNeedUpdate=!1),H.isSpriteMaterial&&he.setValue(O,"center",W.center),he.setValue(O,"modelViewMatrix",W.modelViewMatrix),he.setValue(O,"normalMatrix",W.normalMatrix),he.setValue(O,"modelMatrix",W.matrixWorld),H.uniformsGroups!==void 0){const ue=H.uniformsGroups;for(let fn=0,ds=ue.length;fn<ds;fn++){const Wc=ue[fn];it.update(Wc,di),it.bind(Wc,di)}}return di}function Np(T,k){T.ambientLightColor.needsUpdate=k,T.lightProbe.needsUpdate=k,T.directionalLights.needsUpdate=k,T.directionalLightShadows.needsUpdate=k,T.pointLights.needsUpdate=k,T.pointLightShadows.needsUpdate=k,T.spotLights.needsUpdate=k,T.spotLightShadows.needsUpdate=k,T.rectAreaLights.needsUpdate=k,T.hemisphereLights.needsUpdate=k}function Fp(T){return T.isMeshLambertMaterial||T.isMeshToonMaterial||T.isMeshPhongMaterial||T.isMeshStandardMaterial||T.isShadowMaterial||T.isShaderMaterial&&T.lights===!0}this.getActiveCubeFace=function(){return N},this.getActiveMipmapLevel=function(){return D},this.getRenderTarget=function(){return $},this.setRenderTargetTextures=function(T,k,Y){const H=q.get(T);H.__autoAllocateDepthBuffer=T.resolveDepthBuffer===!1,H.__autoAllocateDepthBuffer===!1&&(H.__useRenderToTexture=!1),q.get(T.texture).__webglTexture=k,q.get(T.depthTexture).__webglTexture=H.__autoAllocateDepthBuffer?void 0:Y,H.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(T,k){const Y=q.get(T);Y.__webglFramebuffer=k,Y.__useDefaultFramebuffer=k===void 0},this.setRenderTarget=function(T,k=0,Y=0){$=T,N=k,D=Y;let H=null,W=!1,gt=!1;if(T){const mt=q.get(T);if(mt.__useDefaultFramebuffer!==void 0){M.bindFramebuffer(O.FRAMEBUFFER,mt.__webglFramebuffer),rt.copy(T.viewport),U.copy(T.scissor),at=T.scissorTest,M.viewport(rt),M.scissor(U),M.setScissorTest(at),Q=-1;return}else if(mt.__webglFramebuffer===void 0)K.setupRenderTarget(T);else if(mt.__hasExternalTextures)K.rebindTextures(T,q.get(T.texture).__webglTexture,q.get(T.depthTexture).__webglTexture);else if(T.depthBuffer){const Vt=T.depthTexture;if(mt.__boundDepthTexture!==Vt){if(Vt!==null&&q.has(Vt)&&(T.width!==Vt.image.width||T.height!==Vt.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");K.setupDepthRenderbuffer(T)}}const Et=T.texture;(Et.isData3DTexture||Et.isDataArrayTexture||Et.isCompressedArrayTexture)&&(gt=!0);const Ct=q.get(T).__webglFramebuffer;T.isWebGLCubeRenderTarget?(Array.isArray(Ct[k])?H=Ct[k][Y]:H=Ct[k],W=!0):T.samples>0&&K.useMultisampledRTT(T)===!1?H=q.get(T).__webglMultisampledFramebuffer:Array.isArray(Ct)?H=Ct[Y]:H=Ct,rt.copy(T.viewport),U.copy(T.scissor),at=T.scissorTest}else rt.copy(yt).multiplyScalar(et).floor(),U.copy(te).multiplyScalar(et).floor(),at=St;if(Y!==0&&(H=z),M.bindFramebuffer(O.FRAMEBUFFER,H)&&M.drawBuffers(T,H),M.viewport(rt),M.scissor(U),M.setScissorTest(at),W){const mt=q.get(T.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_CUBE_MAP_POSITIVE_X+k,mt.__webglTexture,Y)}else if(gt){const mt=k;for(let Et=0;Et<T.textures.length;Et++){const Ct=q.get(T.textures[Et]);O.framebufferTextureLayer(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0+Et,Ct.__webglTexture,Y,mt)}}else if(T!==null&&Y!==0){const mt=q.get(T.texture);O.framebufferTexture2D(O.FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,mt.__webglTexture,Y)}Q=-1},this.readRenderTargetPixels=function(T,k,Y,H,W,gt,Mt,mt=0){if(!(T&&T.isWebGLRenderTarget)){Qt("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Et=q.get(T).__webglFramebuffer;if(T.isWebGLCubeRenderTarget&&Mt!==void 0&&(Et=Et[Mt]),Et){M.bindFramebuffer(O.FRAMEBUFFER,Et);try{const Ct=T.textures[mt],Vt=Ct.format,qt=Ct.type;if(T.textures.length>1&&O.readBuffer(O.COLOR_ATTACHMENT0+mt),!P.textureFormatReadable(Vt)){Qt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!P.textureTypeReadable(qt)){Qt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}k>=0&&k<=T.width-H&&Y>=0&&Y<=T.height-W&&O.readPixels(k,Y,H,W,dt.convert(Vt),dt.convert(qt),gt)}finally{const Ct=$!==null?q.get($).__webglFramebuffer:null;M.bindFramebuffer(O.FRAMEBUFFER,Ct)}}},this.readRenderTargetPixelsAsync=async function(T,k,Y,H,W,gt,Mt,mt=0){if(!(T&&T.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Et=q.get(T).__webglFramebuffer;if(T.isWebGLCubeRenderTarget&&Mt!==void 0&&(Et=Et[Mt]),Et)if(k>=0&&k<=T.width-H&&Y>=0&&Y<=T.height-W){M.bindFramebuffer(O.FRAMEBUFFER,Et);const Ct=T.textures[mt],Vt=Ct.format,qt=Ct.type;if(T.textures.length>1&&O.readBuffer(O.COLOR_ATTACHMENT0+mt),!P.textureFormatReadable(Vt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!P.textureTypeReadable(qt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const Pt=O.createBuffer();O.bindBuffer(O.PIXEL_PACK_BUFFER,Pt),O.bufferData(O.PIXEL_PACK_BUFFER,gt.byteLength,O.STREAM_READ),O.readPixels(k,Y,H,W,dt.convert(Vt),dt.convert(qt),0);const re=$!==null?q.get($).__webglFramebuffer:null;M.bindFramebuffer(O.FRAMEBUFFER,re);const Se=O.fenceSync(O.SYNC_GPU_COMMANDS_COMPLETE,0);return O.flush(),await ym(O,Se,4),O.bindBuffer(O.PIXEL_PACK_BUFFER,Pt),O.getBufferSubData(O.PIXEL_PACK_BUFFER,0,gt),O.deleteBuffer(Pt),O.deleteSync(Se),gt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(T,k=null,Y=0){const H=Math.pow(2,-Y),W=Math.floor(T.image.width*H),gt=Math.floor(T.image.height*H),Mt=k!==null?k.x:0,mt=k!==null?k.y:0;K.setTexture2D(T,0),O.copyTexSubImage2D(O.TEXTURE_2D,Y,0,0,Mt,mt,W,gt),M.unbindTexture()},this.copyTextureToTexture=function(T,k,Y=null,H=null,W=0,gt=0){let Mt,mt,Et,Ct,Vt,qt,Pt,re,Se;const ve=T.isCompressedTexture?T.mipmaps[gt]:T.image;if(Y!==null)Mt=Y.max.x-Y.min.x,mt=Y.max.y-Y.min.y,Et=Y.isBox3?Y.max.z-Y.min.z:1,Ct=Y.min.x,Vt=Y.min.y,qt=Y.isBox3?Y.min.z:0;else{const we=Math.pow(2,-W);Mt=Math.floor(ve.width*we),mt=Math.floor(ve.height*we),T.isDataArrayTexture?Et=ve.depth:T.isData3DTexture?Et=Math.floor(ve.depth*we):Et=1,Ct=0,Vt=0,qt=0}H!==null?(Pt=H.x,re=H.y,Se=H.z):(Pt=0,re=0,Se=0);const le=dt.convert(k.format),Ve=dt.convert(k.type);let vt;k.isData3DTexture?(K.setTexture3D(k,0),vt=O.TEXTURE_3D):k.isDataArrayTexture||k.isCompressedArrayTexture?(K.setTexture2DArray(k,0),vt=O.TEXTURE_2D_ARRAY):(K.setTexture2D(k,0),vt=O.TEXTURE_2D),M.activeTexture(O.TEXTURE0),M.pixelStorei(O.UNPACK_FLIP_Y_WEBGL,k.flipY),M.pixelStorei(O.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),M.pixelStorei(O.UNPACK_ALIGNMENT,k.unpackAlignment);const ii=M.getParameter(O.UNPACK_ROW_LENGTH),jt=M.getParameter(O.UNPACK_IMAGE_HEIGHT),di=M.getParameter(O.UNPACK_SKIP_PIXELS),Li=M.getParameter(O.UNPACK_SKIP_ROWS),un=M.getParameter(O.UNPACK_SKIP_IMAGES);M.pixelStorei(O.UNPACK_ROW_LENGTH,ve.width),M.pixelStorei(O.UNPACK_IMAGE_HEIGHT,ve.height),M.pixelStorei(O.UNPACK_SKIP_PIXELS,Ct),M.pixelStorei(O.UNPACK_SKIP_ROWS,Vt),M.pixelStorei(O.UNPACK_SKIP_IMAGES,qt);const us=T.isDataArrayTexture||T.isData3DTexture,he=k.isDataArrayTexture||k.isData3DTexture;if(T.isDepthTexture){const we=q.get(T),dn=q.get(k),ue=q.get(we.__renderTarget),fn=q.get(dn.__renderTarget);M.bindFramebuffer(O.READ_FRAMEBUFFER,ue.__webglFramebuffer),M.bindFramebuffer(O.DRAW_FRAMEBUFFER,fn.__webglFramebuffer);for(let ds=0;ds<Et;ds++)us&&(O.framebufferTextureLayer(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,q.get(T).__webglTexture,W,qt+ds),O.framebufferTextureLayer(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,q.get(k).__webglTexture,gt,Se+ds)),O.blitFramebuffer(Ct,Vt,Mt,mt,Pt,re,Mt,mt,O.DEPTH_BUFFER_BIT,O.NEAREST);M.bindFramebuffer(O.READ_FRAMEBUFFER,null),M.bindFramebuffer(O.DRAW_FRAMEBUFFER,null)}else if(W!==0||T.isRenderTargetTexture||q.has(T)){const we=q.get(T),dn=q.get(k);M.bindFramebuffer(O.READ_FRAMEBUFFER,G),M.bindFramebuffer(O.DRAW_FRAMEBUFFER,L);for(let ue=0;ue<Et;ue++)us?O.framebufferTextureLayer(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,we.__webglTexture,W,qt+ue):O.framebufferTexture2D(O.READ_FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,we.__webglTexture,W),he?O.framebufferTextureLayer(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,dn.__webglTexture,gt,Se+ue):O.framebufferTexture2D(O.DRAW_FRAMEBUFFER,O.COLOR_ATTACHMENT0,O.TEXTURE_2D,dn.__webglTexture,gt),W!==0?O.blitFramebuffer(Ct,Vt,Mt,mt,Pt,re,Mt,mt,O.COLOR_BUFFER_BIT,O.NEAREST):he?O.copyTexSubImage3D(vt,gt,Pt,re,Se+ue,Ct,Vt,Mt,mt):O.copyTexSubImage2D(vt,gt,Pt,re,Ct,Vt,Mt,mt);M.bindFramebuffer(O.READ_FRAMEBUFFER,null),M.bindFramebuffer(O.DRAW_FRAMEBUFFER,null)}else he?T.isDataTexture||T.isData3DTexture?O.texSubImage3D(vt,gt,Pt,re,Se,Mt,mt,Et,le,Ve,ve.data):k.isCompressedArrayTexture?O.compressedTexSubImage3D(vt,gt,Pt,re,Se,Mt,mt,Et,le,ve.data):O.texSubImage3D(vt,gt,Pt,re,Se,Mt,mt,Et,le,Ve,ve):T.isDataTexture?O.texSubImage2D(O.TEXTURE_2D,gt,Pt,re,Mt,mt,le,Ve,ve.data):T.isCompressedTexture?O.compressedTexSubImage2D(O.TEXTURE_2D,gt,Pt,re,ve.width,ve.height,le,ve.data):O.texSubImage2D(O.TEXTURE_2D,gt,Pt,re,Mt,mt,le,Ve,ve);M.pixelStorei(O.UNPACK_ROW_LENGTH,ii),M.pixelStorei(O.UNPACK_IMAGE_HEIGHT,jt),M.pixelStorei(O.UNPACK_SKIP_PIXELS,di),M.pixelStorei(O.UNPACK_SKIP_ROWS,Li),M.pixelStorei(O.UNPACK_SKIP_IMAGES,un),gt===0&&k.generateMipmaps&&O.generateMipmap(vt),M.unbindTexture()},this.initRenderTarget=function(T){q.get(T).__webglFramebuffer===void 0&&K.setupRenderTarget(T)},this.initTexture=function(T){T.isCubeTexture?K.setTextureCube(T,0):T.isData3DTexture?K.setTexture3D(T,0):T.isDataArrayTexture||T.isCompressedArrayTexture?K.setTexture2DArray(T,0):K.setTexture2D(T,0),M.unbindTexture()},this.resetState=function(){N=0,D=0,$=null,M.reset(),xt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return ki}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=Zt._getDrawingBufferColorSpace(t),e.unpackColorSpace=Zt._getUnpackColorSpace()}}const Ju={type:"change"},Cc={type:"start"},ap={type:"end"},za=new Ec,Qu=new Cn,yv=Math.cos(70*Yh.DEG2RAD),De=new B,je=2*Math.PI,oe={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},El=1e-6;class _v extends Jf{constructor(t,e=null){super(t,e),this.state=oe.NONE,this.target=new B,this.cursor=new B,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:sr.ROTATE,MIDDLE:sr.DOLLY,RIGHT:sr.PAN},this.touches={ONE:er.ROTATE,TWO:er.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle="auto",this._domElementKeyEvents=null,this._lastPosition=new B,this._lastQuaternion=new Un,this._lastTargetPosition=new B,this._quat=new Un().setFromUnitVectors(t.up,new B(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Au,this._sphericalDelta=new Au,this._scale=1,this._panOffset=new B,this._rotateStart=new Ut,this._rotateEnd=new Ut,this._rotateDelta=new Ut,this._panStart=new Ut,this._panEnd=new Ut,this._panDelta=new Ut,this._dollyStart=new Ut,this._dollyEnd=new Ut,this._dollyDelta=new Ut,this._dollyDirection=new B,this._mouse=new Ut,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Mv.bind(this),this._onPointerDown=vv.bind(this),this._onPointerUp=bv.bind(this),this._onContextMenu=Rv.bind(this),this._onMouseWheel=Ev.bind(this),this._onKeyDown=Tv.bind(this),this._onTouchStart=Av.bind(this),this._onTouchMove=Cv.bind(this),this._onMouseDown=Sv.bind(this),this._onMouseMove=wv.bind(this),this._interceptControlDown=Pv.bind(this),this._interceptControlUp=Iv.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(t){this._cursorStyle=t,t==="grab"?this.domElement.style.cursor="grab":this.domElement.style.cursor="auto"}get cursorStyle(){return this._cursorStyle}connect(t){super.connect(t),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction=""}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(t){t.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=t}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(Ju),this.update(),this.state=oe.NONE}pan(t,e){this._pan(t,e),this.update()}dollyIn(t){this._dollyIn(t),this.update()}dollyOut(t){this._dollyOut(t),this.update()}rotateLeft(t){this._rotateLeft(t),this.update()}rotateUp(t){this._rotateUp(t),this.update()}update(t=null){const e=this.object.position;De.copy(e).sub(this.target),De.applyQuaternion(this._quat),this._spherical.setFromVector3(De),this.autoRotate&&this.state===oe.NONE&&this._rotateLeft(this._getAutoRotationAngle(t)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let i=this.minAzimuthAngle,n=this.maxAzimuthAngle;isFinite(i)&&isFinite(n)&&(i<-Math.PI?i+=je:i>Math.PI&&(i-=je),n<-Math.PI?n+=je:n>Math.PI&&(n-=je),i<=n?this._spherical.theta=Math.max(i,Math.min(n,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(i+n)/2?Math.max(i,this._spherical.theta):Math.min(n,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let s=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const a=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),s=a!=this._spherical.radius}if(De.setFromSpherical(this._spherical),De.applyQuaternion(this._quatInverse),e.copy(this.target).add(De),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let a=null;if(this.object.isPerspectiveCamera){const o=De.length();a=this._clampDistance(o*this._scale);const l=o-a;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),s=!!l}else if(this.object.isOrthographicCamera){const o=new B(this._mouse.x,this._mouse.y,0);o.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),s=l!==this.object.zoom;const h=new B(this._mouse.x,this._mouse.y,0);h.unproject(this.object),this.object.position.sub(h).add(o),this.object.updateMatrixWorld(),a=De.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;a!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(a).add(this.object.position):(za.origin.copy(this.object.position),za.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(za.direction))<yv?this.object.lookAt(this.target):(Qu.setFromNormalAndCoplanarPoint(this.object.up,this.target),za.intersectPlane(Qu,this.target))))}else if(this.object.isOrthographicCamera){const a=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),a!==this.object.zoom&&(this.object.updateProjectionMatrix(),s=!0)}return this._scale=1,this._performCursorZoom=!1,s||this._lastPosition.distanceToSquared(this.object.position)>El||8*(1-this._lastQuaternion.dot(this.object.quaternion))>El||this._lastTargetPosition.distanceToSquared(this.target)>El?(this.dispatchEvent(Ju),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(t){return t!==null?je/60*this.autoRotateSpeed*t:je/60/60*this.autoRotateSpeed}_getZoomScale(t){const e=Math.abs(t*.01);return Math.pow(.95,this.zoomSpeed*e)}_rotateLeft(t){this._sphericalDelta.theta-=t}_rotateUp(t){this._sphericalDelta.phi-=t}_panLeft(t,e){De.setFromMatrixColumn(e,0),De.multiplyScalar(-t),this._panOffset.add(De)}_panUp(t,e){this.screenSpacePanning===!0?De.setFromMatrixColumn(e,1):(De.setFromMatrixColumn(e,0),De.crossVectors(this.object.up,De)),De.multiplyScalar(t),this._panOffset.add(De)}_pan(t,e){const i=this.domElement;if(this.object.isPerspectiveCamera){const n=this.object.position;De.copy(n).sub(this.target);let s=De.length();s*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*t*s/i.clientHeight,this.object.matrix),this._panUp(2*e*s/i.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(t*(this.object.right-this.object.left)/this.object.zoom/i.clientWidth,this.object.matrix),this._panUp(e*(this.object.top-this.object.bottom)/this.object.zoom/i.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(t,e){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const i=this.domElement.getBoundingClientRect(),n=t-i.left,s=e-i.top,a=i.width,o=i.height;this._mouse.x=n/a*2-1,this._mouse.y=-(s/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(t){return Math.max(this.minDistance,Math.min(this.maxDistance,t))}_handleMouseDownRotate(t){this._rotateStart.set(t.clientX,t.clientY)}_handleMouseDownDolly(t){this._updateZoomParameters(t.clientX,t.clientX),this._dollyStart.set(t.clientX,t.clientY)}_handleMouseDownPan(t){this._panStart.set(t.clientX,t.clientY)}_handleMouseMoveRotate(t){this._rotateEnd.set(t.clientX,t.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(je*this._rotateDelta.x/e.clientHeight),this._rotateUp(je*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(t){this._dollyEnd.set(t.clientX,t.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(t){this._panEnd.set(t.clientX,t.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(t){this._updateZoomParameters(t.clientX,t.clientY),t.deltaY<0?this._dollyIn(this._getZoomScale(t.deltaY)):t.deltaY>0&&this._dollyOut(this._getZoomScale(t.deltaY)),this.update()}_handleKeyDown(t){let e=!1;switch(t.code){case this.keys.UP:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),e=!0;break;case this.keys.BOTTOM:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(-je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),e=!0;break;case this.keys.LEFT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),e=!0;break;case this.keys.RIGHT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(-je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),e=!0;break}e&&(t.preventDefault(),this.update())}_handleTouchStartRotate(t){if(this._pointers.length===1)this._rotateStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._rotateStart.set(i,n)}}_handleTouchStartPan(t){if(this._pointers.length===1)this._panStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._panStart.set(i,n)}}_handleTouchStartDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,n=t.pageY-e.y,s=Math.sqrt(i*i+n*n);this._dollyStart.set(0,s)}_handleTouchStartDollyPan(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enablePan&&this._handleTouchStartPan(t)}_handleTouchStartDollyRotate(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enableRotate&&this._handleTouchStartRotate(t)}_handleTouchMoveRotate(t){if(this._pointers.length==1)this._rotateEnd.set(t.pageX,t.pageY);else{const i=this._getSecondPointerPosition(t),n=.5*(t.pageX+i.x),s=.5*(t.pageY+i.y);this._rotateEnd.set(n,s)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(je*this._rotateDelta.x/e.clientHeight),this._rotateUp(je*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(t){if(this._pointers.length===1)this._panEnd.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._panEnd.set(i,n)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,n=t.pageY-e.y,s=Math.sqrt(i*i+n*n);this._dollyEnd.set(0,s),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const a=(t.pageX+e.x)*.5,o=(t.pageY+e.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enablePan&&this._handleTouchMovePan(t)}_handleTouchMoveDollyRotate(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enableRotate&&this._handleTouchMoveRotate(t)}_addPointer(t){this._pointers.push(t.pointerId)}_removePointer(t){delete this._pointerPositions[t.pointerId];for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId){this._pointers.splice(e,1);return}}_isTrackingPointer(t){for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId)return!0;return!1}_trackPointer(t){let e=this._pointerPositions[t.pointerId];e===void 0&&(e=new Ut,this._pointerPositions[t.pointerId]=e),e.set(t.pageX,t.pageY)}_getSecondPointerPosition(t){const e=t.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[e]}_customWheelEvent(t){const e=t.deltaMode,i={clientX:t.clientX,clientY:t.clientY,deltaY:t.deltaY};switch(e){case 1:i.deltaY*=16;break;case 2:i.deltaY*=100;break}return t.ctrlKey&&!this._controlActive&&(i.deltaY*=10),i}}function vv(r){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(r.pointerId),this.domElement.ownerDocument.addEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(r)&&(this._addPointer(r),r.pointerType==="touch"?this._onTouchStart(r):this._onMouseDown(r),this._cursorStyle==="grab"&&(this.domElement.style.cursor="grabbing")))}function Mv(r){this.enabled!==!1&&(r.pointerType==="touch"?this._onTouchMove(r):this._onMouseMove(r))}function bv(r){switch(this._removePointer(r),this._pointers.length){case 0:this.domElement.releasePointerCapture(r.pointerId),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(ap),this.state=oe.NONE,this._cursorStyle==="grab"&&(this.domElement.style.cursor="grab");break;case 1:const t=this._pointers[0],e=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:e.x,pageY:e.y});break}}function Sv(r){let t;switch(r.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case sr.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(r),this.state=oe.DOLLY;break;case sr.ROTATE:if(r.ctrlKey||r.metaKey||r.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(r),this.state=oe.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(r),this.state=oe.ROTATE}break;case sr.PAN:if(r.ctrlKey||r.metaKey||r.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(r),this.state=oe.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(r),this.state=oe.PAN}break;default:this.state=oe.NONE}this.state!==oe.NONE&&this.dispatchEvent(Cc)}function wv(r){switch(this.state){case oe.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(r);break;case oe.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(r);break;case oe.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(r);break}}function Ev(r){this.enabled===!1||this.enableZoom===!1||this.state!==oe.NONE||(r.preventDefault(),this.dispatchEvent(Cc),this._handleMouseWheel(this._customWheelEvent(r)),this.dispatchEvent(ap))}function Tv(r){this.enabled!==!1&&this._handleKeyDown(r)}function Av(r){switch(this._trackPointer(r),this._pointers.length){case 1:switch(this.touches.ONE){case er.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(r),this.state=oe.TOUCH_ROTATE;break;case er.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(r),this.state=oe.TOUCH_PAN;break;default:this.state=oe.NONE}break;case 2:switch(this.touches.TWO){case er.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(r),this.state=oe.TOUCH_DOLLY_PAN;break;case er.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(r),this.state=oe.TOUCH_DOLLY_ROTATE;break;default:this.state=oe.NONE}break;default:this.state=oe.NONE}this.state!==oe.NONE&&this.dispatchEvent(Cc)}function Cv(r){switch(this._trackPointer(r),this.state){case oe.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(r),this.update();break;case oe.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(r),this.update();break;case oe.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(r),this.update();break;case oe.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(r),this.update();break;default:this.state=oe.NONE}}function Rv(r){this.enabled!==!1&&r.preventDefault()}function Pv(r){r.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function Iv(r){r.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}const Cs=new zn(0,0,0,"YXZ"),Rs=new B,Dv={type:"change"},Lv={type:"lock"},Nv={type:"unlock"},ju=.002,td=Math.PI/2;class Fv extends Jf{constructor(t,e=null){super(t,e),this.isLocked=!1,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.pointerSpeed=1,this._onMouseMove=Uv.bind(this),this._onPointerlockChange=zv.bind(this),this._onPointerlockError=Ov.bind(this),this.domElement!==null&&this.connect(this.domElement)}connect(t){super.connect(t),this.domElement.ownerDocument.addEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.addEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.addEventListener("pointerlockerror",this._onPointerlockError)}disconnect(){this.domElement.ownerDocument.removeEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.removeEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.removeEventListener("pointerlockerror",this._onPointerlockError)}dispose(){this.disconnect()}getDirection(t){return t.set(0,0,-1).applyQuaternion(this.object.quaternion)}moveForward(t){if(this.enabled===!1)return;const e=this.object;Rs.setFromMatrixColumn(e.matrix,0),Rs.crossVectors(e.up,Rs),e.position.addScaledVector(Rs,t)}moveRight(t){if(this.enabled===!1)return;const e=this.object;Rs.setFromMatrixColumn(e.matrix,0),e.position.addScaledVector(Rs,t)}lock(t=!1){this.domElement.requestPointerLock({unadjustedMovement:t})}unlock(){this.domElement.ownerDocument.exitPointerLock()}}function Uv(r){if(this.enabled===!1||this.isLocked===!1)return;const t=this.object;Cs.setFromQuaternion(t.quaternion),Cs.y-=r.movementX*ju*this.pointerSpeed,Cs.x-=r.movementY*ju*this.pointerSpeed,Cs.x=Math.max(td-this.maxPolarAngle,Math.min(td-this.minPolarAngle,Cs.x)),t.quaternion.setFromEuler(Cs),this.dispatchEvent(Dv)}function zv(){this.domElement.ownerDocument.pointerLockElement===this.domElement?(this.dispatchEvent(Lv),this.isLocked=!0):(this.dispatchEvent(Nv),this.isLocked=!1)}function Ov(){console.error("THREE.PointerLockControls: Unable to use Pointer Lock API")}class kv extends wo{constructor(){super(),this.name="RoomEnvironment",this.position.y=-3.5;const t=new hs;t.deleteAttribute("uv");const e=new vu({side:Be}),i=new vu,n=new x0(16777215,900,28,2);n.position.set(.418,16.199,.3),this.add(n);const s=new Pe(t,e);s.position.set(-.757,13.219,.717),s.scale.set(31.713,28.305,28.591),this.add(s);const a=new e0(t,i,6),o=new Pi;o.position.set(-10.906,2.009,1.846),o.rotation.set(0,-.195,0),o.scale.set(2.328,7.905,4.651),o.updateMatrix(),a.setMatrixAt(0,o.matrix),o.position.set(-5.607,-.754,-.758),o.rotation.set(0,.994,0),o.scale.set(1.97,1.534,3.955),o.updateMatrix(),a.setMatrixAt(1,o.matrix),o.position.set(6.167,.857,7.803),o.rotation.set(0,.561,0),o.scale.set(3.927,6.285,3.687),o.updateMatrix(),a.setMatrixAt(2,o.matrix),o.position.set(-2.017,.018,6.124),o.rotation.set(0,.333,0),o.scale.set(2.002,4.566,2.064),o.updateMatrix(),a.setMatrixAt(3,o.matrix),o.position.set(2.291,-.756,-2.621),o.rotation.set(0,-.286,0),o.scale.set(1.546,1.552,1.496),o.updateMatrix(),a.setMatrixAt(4,o.matrix),o.position.set(-2.193,-.369,-5.547),o.rotation.set(0,.516,0),o.scale.set(3.875,3.487,2.986),o.updateMatrix(),a.setMatrixAt(5,o.matrix),this.add(a);const l=new Pe(t,Ps(50));l.position.set(-16.116,14.37,8.208),l.scale.set(.1,2.428,2.739),this.add(l);const h=new Pe(t,Ps(50));h.position.set(-16.109,18.021,-8.207),h.scale.set(.1,2.425,2.751),this.add(h);const c=new Pe(t,Ps(17));c.position.set(14.904,12.198,-1.832),c.scale.set(.15,4.265,6.331),this.add(c);const d=new Pe(t,Ps(43));d.position.set(-.462,8.89,14.52),d.scale.set(4.38,5.441,.088),this.add(d);const u=new Pe(t,Ps(20));u.position.set(3.235,11.486,-12.541),u.scale.set(2.5,2,.1),this.add(u);const f=new Pe(t,Ps(100));f.position.set(0,20,0),f.scale.set(1,.1,1),this.add(f)}dispose(){const t=new Set;this.traverse(e=>{e.isMesh&&(t.add(e.geometry),t.add(e.material))});for(const e of t)e.dispose()}}function Ps(r){return new u0({color:0,emissive:16777215,emissiveIntensity:r})}class la extends Pe{constructor(){const t=la.SkyShader,e=new xi({name:t.name,uniforms:Yf.clone(t.uniforms),vertexShader:t.vertexShader,fragmentShader:t.fragmentShader,side:Be,depthWrite:!1});super(new hs(1,1,1),e),this.isSky=!0}}la.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new B},up:{value:new B(0,1,0)},cloudScale:{value:2e-4},cloudSpeed:{value:1e-4},cloudCoverage:{value:.4},cloudDensity:{value:.4},cloudElevation:{value:.5},showSunDisc:{value:1},time:{value:0}},vertexShader:`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;
		uniform vec3 up;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		// constants for atmospheric scattering
		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		// wavelength of used primaries, according to preetham
		const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
		// this pre-calculation replaces older TotalRayleigh(vec3 lambda) function:
		// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
		const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

		// mie stuff
		// K coefficient for the primaries
		const float v = 4.0;
		const vec3 K = vec3( 0.686, 0.678, 0.666 );
		// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
		const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

		// earth shadow hack
		// cutoffAngle = pi / 1.95;
		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {
			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
			return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
		}

		vec3 totalMie( float T ) {
			float c = ( 0.2 * T ) * 10E-18;
			return 0.434 * c * MieConst;
		}

		void main() {

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vWorldPosition = worldPosition.xyz;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			gl_Position.z = gl_Position.w; // set z to camera.far

			vSunDirection = normalize( sunPosition );

			vSunE = sunIntensity( dot( vSunDirection, up ) );

			vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

			float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

			// extinction (absorption + out scattering)
			// rayleigh coefficients
			vBetaR = totalRayleigh * rayleighCoefficient;

			// mie coefficients
			vBetaM = totalMie( turbidity ) * mieCoefficient;

		}`,fragmentShader:`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;
		uniform vec3 up;
		uniform float cloudScale;
		uniform float cloudSpeed;
		uniform float cloudCoverage;
		uniform float cloudDensity;
		uniform float cloudElevation;
		uniform float showSunDisc;
		uniform float time;

		// Cloud noise functions
		float hash( vec2 p ) {
			return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
		}

		float noise( vec2 p ) {
			vec2 i = floor( p );
			vec2 f = fract( p );
			f = f * f * ( 3.0 - 2.0 * f );
			float a = hash( i );
			float b = hash( i + vec2( 1.0, 0.0 ) );
			float c = hash( i + vec2( 0.0, 1.0 ) );
			float d = hash( i + vec2( 1.0, 1.0 ) );
			return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
		}

		float fbm( vec2 p ) {
			float value = 0.0;
			float amplitude = 0.5;
			for ( int i = 0; i < 5; i ++ ) {
				value += amplitude * noise( p );
				p *= 2.0;
				amplitude *= 0.5;
			}
			return value;
		}

		// constants for atmospheric scattering
		const float pi = 3.141592653589793238462643383279502884197169;

		const float n = 1.0003; // refractive index of air
		const float N = 2.545E25; // number of molecules per unit volume for air at 288.15K and 1013mb (sea level -45 celsius)

		// optical length at zenith for molecules
		const float rayleighZenithLength = 8.4E3;
		const float mieZenithLength = 1.25E3;
		// 66 arc seconds -> degrees, and the cosine of that
		const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

		// 3.0 / ( 16.0 * pi )
		const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
		// 1.0 / ( 4.0 * pi )
		const float ONE_OVER_FOURPI = 0.07957747154594767;

		float rayleighPhase( float cosTheta ) {
			return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
		}

		float hgPhase( float cosTheta, float g ) {
			float g2 = pow( g, 2.0 );
			float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
			return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
		}

		void main() {

			vec3 direction = normalize( vWorldPosition - cameraPosition );

			// optical length
			// cutoff angle at 90 to avoid singularity in next formula.
			float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
			float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
			float sR = rayleighZenithLength * inverse;
			float sM = mieZenithLength * inverse;

			// combined extinction factor
			vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

			// in scattering
			float cosTheta = dot( direction, vSunDirection );

			float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
			vec3 betaRTheta = vBetaR * rPhase;

			float mPhase = hgPhase( cosTheta, mieDirectionalG );
			vec3 betaMTheta = vBetaM * mPhase;

			vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
			Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

			// nightsky
			float theta = acos( direction.y ); // elevation --> y-axis, [-pi/2, pi/2]
			float phi = atan( direction.z, direction.x ); // azimuth --> x-axis [-pi/2, pi/2]
			vec2 uv = vec2( phi, theta ) / vec2( 2.0 * pi, pi ) + vec2( 0.5, 0.0 );
			vec3 L0 = vec3( 0.1 ) * Fex;

			// composition + solar disc
			float sundisc = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta ) * showSunDisc;
			L0 += ( vSunE * 19000.0 * Fex ) * sundisc;

			vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

			// Clouds
			if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {

				// Project to cloud plane (higher elevation = clouds appear lower/closer)
				float elevation = mix( 1.0, 0.1, cloudElevation );
				vec2 cloudUV = direction.xz / ( direction.y * elevation );
				cloudUV *= cloudScale;
				cloudUV += time * cloudSpeed;

				// Multi-octave noise for fluffy clouds
				float cloudNoise = fbm( cloudUV * 1000.0 );
				cloudNoise += 0.5 * fbm( cloudUV * 2000.0 + 3.7 );
				cloudNoise = cloudNoise * 0.5 + 0.5;

				// Apply coverage threshold
				float cloudMask = smoothstep( 1.0 - cloudCoverage, 1.0 - cloudCoverage + 0.3, cloudNoise );

				// Fade clouds near horizon (adjusted by elevation)
				float horizonFade = smoothstep( 0.0, 0.1 + 0.2 * cloudElevation, direction.y );
				cloudMask *= horizonFade;

				// Cloud lighting based on sun position
				float sunInfluence = dot( direction, vSunDirection ) * 0.5 + 0.5;
				float daylight = max( 0.0, vSunDirection.y * 2.0 );

				// Base cloud color affected by atmosphere
				vec3 atmosphereColor = Lin * 0.04;
				vec3 cloudColor = mix( vec3( 0.3 ), vec3( 1.0 ), daylight );
				cloudColor = mix( cloudColor, atmosphereColor + vec3( 1.0 ), sunInfluence * 0.5 );
				cloudColor *= vSunE * 0.00002;

				// Blend clouds with sky
				texColor = mix( texColor, cloudColor, cloudMask * cloudDensity );

			}

			gl_FragColor = vec4( texColor, 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};const Bv=`
  float a3Hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float a3Noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(a3Hash(i + vec2(0.0, 0.0)), a3Hash(i + vec2(1.0, 0.0)), u.x),
      mix(a3Hash(i + vec2(0.0, 1.0)), a3Hash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
  float a3Fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      total += amplitude * a3Noise(p);
      p = p * 2.03 + 17.3;
      amplitude *= 0.5;
    }
    return total;
  }
`;function ed(r={}){const t=Number(r.radius??4e3),e=id(r.sunDirection,[.35,.22,-1]).normalize(),i={uZenith:{value:new zt(r.zenith??2781124)},uHorizon:{value:new zt(r.horizon??12376046)},uGround:{value:new zt(r.ground??7038296)},uSunColor:{value:new zt(r.sunColor??16773840)},uCloudColor:{value:new zt(r.cloudColor??16777215)},uCloudShadow:{value:new zt(r.cloudShadow??9083824)},uSunDirection:{value:e.clone()},uSunSize:{value:Number(r.sunSize??.004)},uSunGlow:{value:Number(r.sunGlow??220)},uCloudCoverage:{value:Number(r.cloudCoverage??.48)},uCloudOpacity:{value:Number(r.cloudOpacity??.9)},uCloudScale:{value:Number(r.cloudScale??1.6)},uCloudSpeed:{value:Number(r.cloudSpeed??.006)},uWindOffset:{value:new Ut},uWindDriven:{value:0},uHaze:{value:Number(r.haze??.35)},uTime:{value:0}},n=new xi({uniforms:i,side:Be,depthWrite:!1,depthTest:!1,vertexShader:`
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,fragmentShader:`
      varying vec3 vDirection;
      uniform vec3 uZenith, uHorizon, uGround, uSunColor;
      uniform vec3 uCloudColor, uCloudShadow, uSunDirection;
      uniform float uSunSize, uSunGlow, uCloudCoverage, uCloudOpacity;
      uniform float uCloudScale, uCloudSpeed, uHaze, uTime, uWindDriven;
      uniform vec2 uWindOffset;
      ${Bv}
      void main() {
        vec3 dir = normalize(vDirection);
        float height = dir.y;

        // Horizon gradient. The 0.42 exponent keeps the bright band low
        // and thin, which is what a real sky does and a linear mix does not.
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(height, 0.0, 1.0), 0.42));
        sky = mix(sky, uGround, 1.0 - smoothstep(-0.10, 0.0, height));

        float sunDot = clamp(dot(dir, normalize(uSunDirection)), 0.0, 1.0);
        // Forward scattering: the whole sky warms towards the sun, most
        // strongly near the horizon. Skipping this is why a gradient sky
        // looks like a painted backdrop.
        sky += uSunColor * pow(sunDot, 6.0) * uHaze *
               (1.0 - smoothstep(0.0, 0.6, height));
        sky += uSunColor * pow(sunDot, uSunGlow) * 0.9;
        float disc = 0.0;
        if (uSunSize > 0.0) {
          disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.25, sunDot);
        }
        sky += uSunColor * disc * 6.0;

        // Clouds live on a virtual plane above the camera, so the
        // projection stretches them towards the horizon exactly as a real
        // cloud deck does.
        float above = max(height, 0.035);
        vec2 plane = dir.xz / above * uCloudScale;
        vec2 drift = mix(vec2(uTime * uCloudSpeed * 60.0, uTime * uCloudSpeed * 22.0), uWindOffset * 0.09, uWindDriven);
        float shape = a3Fbm(plane * 0.09 + drift);
        vec2 detailDrift = mix(-drift * 1.7, uWindOffset * 0.31, uWindDriven);
        float detail = a3Fbm(plane * 0.31 + detailDrift);
        float density = shape * 0.78 + detail * 0.22;
        float cover = smoothstep(uCloudCoverage, uCloudCoverage + 0.22, density);
        cover *= smoothstep(0.015, 0.22, height) * uCloudOpacity;
        // One fbm sample offset towards the sun is enough to read as
        // self-shadowing, and it is what gives the deck volume.
        float lit = smoothstep(0.35, 0.75,
          a3Fbm((plane + normalize(uSunDirection).xz * 6.0) * 0.09 + drift));
        vec3 cloud = mix(uCloudShadow, uCloudColor, lit);
        cloud += uSunColor * pow(sunDot, 24.0) * 0.6;

        vec3 color = mix(sky, cloud, cover);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `}),s=new Pe(new a0(t,48,32),n);return s.name="A3GameSkyGradient",s.frustumCulled=!1,s.renderOrder=-1e3,s.onBeforeRender=(a,o,l)=>{l.getWorldPosition(s.position),s.parent&&s.parent.worldToLocal(s.position),s.updateMatrixWorld(!0)},s.userData.update=(a,o=r.windField)=>{if(i.uTime.value+=Number(a)||0,o){const l=i.uCloudScale.value/Math.max(1,Number(r.cloudHeight??120));i.uWindOffset.value.set(-o.displacement.x*l,-o.displacement.z*l),i.uWindDriven.value=1}},s.userData.setSunDirection=a=>{i.uSunDirection.value.copy(id(a,[.35,.22,-1])).normalize()},s.userData.uniforms=i,s}function id(r,t=[0,0,0]){return r?.isVector3?r.clone():Array.isArray(r)&&r.length>=3?new B(Number(r[0]),Number(r[1]),Number(r[2])):r&&typeof r=="object"&&"x"in r?new B(Number(r.x??0),Number(r.y??0),Number(r.z??0)):new B(t[0],t[1],t[2])}const Vv=(r=[0,0,0])=>{const t=Array.isArray(r)?r:[r.x,r.y,r.z];if(t.length!==3||!t.every(e=>Number.isFinite(Number(e))))throw new TypeError("Wind velocity must contain three finite numbers in metres/second");return new B(...t.map(Number))},Is=(r,t,e=0)=>{const i=Number(r??t);if(!Number.isFinite(i)||i<e)throw new RangeError("Invalid wind parameter");return i};class Gv{constructor(t={}){this.velocity=new B,this.targetVelocity=new B,this.displacement=new B,this.elapsedSeconds=0,this.set(t,!0)}set(t={},e=!1){const i=t.velocity===void 0?this.targetVelocity.clone():Vv(t.velocity),n=Is(t.gustStrength,this.gustStrength??0),s=Is(t.gustPeriod,this.gustPeriod??6,.1),a=Is(t.spatialScale,this.spatialScale??30,.1),o=Is(t.response,this.response??1.5,.01),l=Is(t.heightShear,this.heightShear??.05),h=Is(t.seed,this.seed??1,-Number.MAX_SAFE_INTEGER);return Object.assign(this,{gustStrength:n,gustPeriod:s,spatialScale:a,response:o,heightShear:l,seed:h}),this.targetVelocity.copy(i),e&&this.velocity.copy(i),this}sample(t,e=this.elapsedSeconds,i=new B){const n=Number(e);if(!Number.isFinite(n))throw new RangeError("Wind time must be finite");const s=t?.x??0,a=t?.y??0,o=t?.z??0,l=this.seed%1e4*.61803398875,h=2*Math.PI/this.gustPeriod,c=Math.sin(n*h+s/this.spatialScale+l),d=Math.sin(n*h*.63-o/this.spatialScale+l*2.1),u=1+this.heightShear*Math.log1p(Math.max(0,a)/10);i.copy(this.velocity).multiplyScalar(u);const f=Math.hypot(this.velocity.x,this.velocity.z),p=f>1e-9?this.velocity.x/f:1,x=f>1e-9?this.velocity.z/f:0;return i.x+=this.gustStrength*(p*c-x*d*.25),i.z+=this.gustStrength*(x*c+p*d*.25),i}update(t){if(!Number.isFinite(t)||t<0)throw new RangeError("Wind dt must be finite and non-negative");if(t===0)return this;const e=this.sample(null,this.elapsedSeconds);this.velocity.lerp(this.targetVelocity,1-Math.exp(-t/this.response)),this.elapsedSeconds+=t;const i=this.sample(null,this.elapsedSeconds);return this.displacement.addScaledVector(e.add(i),t*.5),this}getState(){return{velocity:this.velocity.toArray(),targetVelocity:this.targetVelocity.toArray(),gustStrength:this.gustStrength,gustPeriod:this.gustPeriod,spatialScale:this.spatialScale,elapsedSeconds:this.elapsedSeconds,displacement:this.displacement.toArray(),seed:this.seed}}}const Yn=Object.freeze({ROOM:"room",SKY:"sky",GRADIENT:"gradient",NONE:"none"}),Tl=Object.freeze({NoToneMapping:Ai,LinearToneMapping:ac,ReinhardToneMapping:oc,CineonToneMapping:lc,ACESFilmicToneMapping:hc,AgXToneMapping:cc,NeutralToneMapping:Vo}),nd=r=>r?typeof r=="string"?document.querySelector(r):r:null;class Hv{constructor(t={}){this.options={antialias:!0,shadows:!0,pixelRatioCap:2,clearColor:1052692,toneMapping:"NeutralToneMapping",toneMappingExposure:1,cameraType:"perspective",frustumHeight:12,fov:50,near:.1,far:2e3,fixedTimeStep:1/60,maxSubSteps:6,maxFrameDelta:.1,environmentUpdateInterval:0,...t};for(const e of["fixedTimeStep","maxFrameDelta","environmentUpdateInterval"]){const i=Number(this.options[e]);if(!Number.isFinite(i)||i<0||e==="maxFrameDelta"&&i===0)throw new RangeError(`${e} must be finite and ${e==="maxFrameDelta"?"positive":"non-negative"}`);this.options[e]=i}if(!Number.isInteger(this.options.maxSubSteps)||this.options.maxSubSteps<1)throw new RangeError("maxSubSteps must be a positive integer");this.container=nd(t.container),this.hudContainer=nd(t.hudContainer),this.renderer=null,this.scene=null,this.camera=null,this.controls=null,this.generatedEnvironment=null,this.skyDome=null,this.sunDirection=new B(.35,.22,-1).normalize(),this.wind=new Gv(t.wind??{}),this.clock=new M0,this.raycaster=new v0,this.pointer=new Ut,this.frameHandle=null,this.running=!1,this.frameCount=0,this.elapsedSeconds=0,this.accumulator=0,this.interpolationAlpha=0,this.droppedSeconds=0,this.lastSubSteps=0,this.renderListeners=new Set,this.interpolatedObjects=new Map,this.sunLights=new Map,this.sunConfigured=!1,this.environmentPresetOptions=null,this.environmentAge=0,this.generatedEnvironmentTarget=null,this.tickListeners=new Set,this.resizeListeners=new Set,this.namedRoots=new Map,this.resizeObserver=null,this.onWindowResize=null}async init(){if(!this.container)throw new Error("A3GameRuntimeHost requires an existing container element");const{clientWidth:t,clientHeight:e}=this.#l();return this.renderer=new xv({antialias:this.options.antialias,alpha:!1,powerPreference:"high-performance",preserveDrawingBuffer:!0}),this.renderer.outputColorSpace=oi,this.renderer.setClearColor(new zt(this.options.clearColor)),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,this.options.pixelRatioCap)),this.renderer.setSize(t,e),this.renderer.toneMapping=Tl[this.options.toneMapping]??Vo,this.renderer.toneMappingExposure=this.options.toneMappingExposure,this.renderer.shadowMap.enabled=!!this.options.shadows,this.renderer.shadowMap.type=vf,this.container.appendChild(this.renderer.domElement),this.scene=new wo,this.scene.name="A3GameWorld",this.camera=this.#h(this.options.cameraType,t/Math.max(1,e)),this.camera.name="A3GameCamera",this.camera.position.set(0,2,8),this.camera.lookAt(0,1,0),this.#f(),this}usePerspectiveCamera(t={}){return Object.assign(this.options,{cameraType:"perspective",fov:Number(t.fov??this.options.fov),near:Number(t.near??this.options.near),far:Number(t.far??this.options.far)}),this.#c("perspective")}useOrthographicCamera(t={}){return Object.assign(this.options,{cameraType:"orthographic",frustumHeight:Math.max(.01,Number(t.frustumHeight??this.options.frustumHeight)),near:Number(t.near??-this.options.far),far:Number(t.far??this.options.far)}),this.#c("orthographic")}start(){if(this.running)return this;if(!this.renderer||!this.scene||!this.camera)throw new Error("A3GameRuntimeHost.init() must run before start()");this.running=!0,this.clock.start();const t=()=>{this.running&&(this.frameHandle=requestAnimationFrame(t),this.tick())};return this.frameHandle=requestAnimationFrame(t),this}stop(){return this.running=!1,this.frameHandle!==null&&(cancelAnimationFrame(this.frameHandle),this.frameHandle=null),this}tick(t){const e=t===void 0?this.clock.getDelta():Number(t);if(!Number.isFinite(e)||e<0)throw new RangeError("tick delta must be finite and non-negative");const i=Math.min(e,this.options.maxFrameDelta);this.droppedSeconds+=e-i,this.frameCount+=1,this.lastSubSteps=0;const n=this.options.fixedTimeStep;if(n>0){for(this.accumulator+=i;this.accumulator+n*1e-9>=n&&this.lastSubSteps<this.options.maxSubSteps;)this.#e(n),this.accumulator=Math.max(0,this.accumulator-n),this.lastSubSteps+=1;if(this.accumulator>=n){const s=Math.floor(this.accumulator/n)*n;this.droppedSeconds+=s,this.accumulator-=s}this.interpolationAlpha=this.accumulator/n}else this.#e(i),this.lastSubSteps=1,this.interpolationAlpha=1;return this.#i(i),this}#e(t){for(const[i,n]of this.interpolatedObjects)n.position.copy(i.position),n.quaternion.copy(i.quaternion),n.scale.copy(i.scale);this.elapsedSeconds+=t,this.#u(t),this.environmentAge+=t;const e=this.options.environmentUpdateInterval;e>0&&this.environmentAge>=e&&this.generatedEnvironment&&this.refreshEnvironment()}#i(t){const e=[];try{for(const[i,n]of this.interpolatedObjects){const s=n.current;s.position.copy(i.position),s.quaternion.copy(i.quaternion),s.scale.copy(i.scale),e.push([i,s]),i.position.lerpVectors(n.position,s.position,this.interpolationAlpha),i.quaternion.slerpQuaternions(n.quaternion,s.quaternion,this.interpolationAlpha),i.scale.lerpVectors(n.scale,s.scale,this.interpolationAlpha),i.updateMatrixWorld(!0)}for(const i of this.renderListeners)i(t,this.interpolationAlpha);this.controls?.update?.(t),this.renderer?.render(this.scene,this.camera)}finally{for(const[i,n]of e)i.position.copy(n.position),i.quaternion.copy(n.quaternion),i.scale.copy(n.scale),i.updateMatrixWorld(!0)}}onRender(t){if(typeof t!="function")throw new TypeError("onRender requires a function");return this.renderListeners.add(t),()=>this.renderListeners.delete(t)}interpolateObject(t){if(!t?.isObject3D)throw new TypeError("interpolateObject requires an Object3D");const e=()=>({position:t.position.clone(),quaternion:t.quaternion.clone(),scale:t.scale.clone()});return this.interpolatedObjects.set(t,{...e(),current:e()}),()=>this.interpolatedObjects.delete(t)}resetInterpolation(t){return this.interpolatedObjects.has(t)&&this.interpolateObject(t),this}onTick(t){if(typeof t!="function")throw new TypeError("onTick requires a function");return this.tickListeners.add(t),()=>this.tickListeners.delete(t)}onResize(t){if(typeof t!="function")throw new TypeError("onResize requires a function");return this.resizeListeners.add(t),()=>this.resizeListeners.delete(t)}add(t,e="entities"){if(!this.scene)throw new Error("init() must run before add()");let i=this.namedRoots.get(e);return i||(i=new ir,i.name=`A3Game_${e}`,this.scene.add(i),this.namedRoots.set(e,i)),i.add(t),t.traverse(n=>{n.isDirectionalLight&&n.userData.a3gameSun&&this.registerSunLight(n)}),t}remove(t){return t?.traverse?.(e=>{this.sunLights.delete(e),this.interpolatedObjects.delete(e)}),t?.parent?.remove(t),this}registerSunLight(t,e){if(!t?.isDirectionalLight)throw new TypeError("Sun must be a DirectionalLight");t.updateWorldMatrix(!0,!1),t.target.updateWorldMatrix(!0,!1);const i=e??t.getWorldPosition(new B).distanceTo(t.target.getWorldPosition(new B));if(!Number.isFinite(i)||i<=0)throw new RangeError("Sun distance must be positive");return this.sunLights.set(t,i),!t.target.parent&&this.scene&&this.scene.add(t.target),this.sunConfigured&&this.#s(),()=>this.sunLights.delete(t)}#s(){this.skyDome?.userData?.setSunDirection?.(this.sunDirection),this.skyDome?.material?.uniforms?.sunPosition?.value.copy(this.sunDirection);for(const[t,e]of this.sunLights){const i=t.target.getWorldPosition(new B).addScaledVector(this.sunDirection,e);t.parent&&t.parent.worldToLocal(i),t.position.copy(i),t.updateMatrixWorld(!0)}}refreshEnvironment(){return this.generatedEnvironment&&this.environmentPresetOptions&&this.#n(this.environmentPresetOptions,!0),this.environmentAge=0,this}getRoot(t="entities"){return this.namedRoots.has(t)||this.add(new ir,t),this.namedRoots.get(t)}attachOrbitControls(t={}){this.detachControls();const e=new _v(this.camera,this.renderer.domElement);e.enableDamping=t.enableDamping!==!1,e.dampingFactor=.08,e.screenSpacePanning=!1,t.maxPolarAngle!==void 0&&(e.maxPolarAngle=t.maxPolarAngle),t.minDistance!==void 0&&(e.minDistance=t.minDistance),t.maxDistance!==void 0&&(e.maxDistance=t.maxDistance);const i=t.target??{x:0,y:1,z:0};return e.target.set(i.x,i.y,i.z),e.update(),this.controls=e,e}attachPointerLockControls(){this.detachControls();const t=new Fv(this.camera,this.container);return this.controls=t,t}async requestPointerLock(){const t=this.container;if(!t?.requestPointerLock)return!1;try{const e=t.requestPointerLock({unadjustedMovement:!0});return e&&typeof e.then=="function"&&await e,!0}catch{try{return t.requestPointerLock(),!0}catch{return!1}}}exitPointerLock(){return document.pointerLockElement&&document.exitPointerLock?.(),this}isPointerLocked(){return document.pointerLockElement===this.container}setFrustumHeight(t){const e=Math.max(.01,Number(t)||0);return e===this.options.frustumHeight?this:(this.options.frustumHeight=e,this.camera?.isOrthographicCamera&&this.#d(),this)}detachControls(){return this.controls&&typeof this.controls.dispose=="function"&&this.controls.dispose(),this.controls=null,this}setWind(t,e=!1){return this.wind.set(t,e),this}setEnvironment(t={}){if(!this.scene)throw new Error("init() must run before setEnvironment()");t.wind&&this.setWind(t.wind);let e=!1;if(t.sunPosition){const i=new B(Number(t.sunPosition.x??0),Number(t.sunPosition.y??1),Number(t.sunPosition.z??0));if(!i.toArray().every(Number.isFinite)||i.lengthSq()<1e-12)throw new RangeError("sunPosition must be a finite non-zero direction");i.normalize(),e=this.sunDirection.distanceToSquared(i)>1e-12,this.sunDirection.copy(i),this.sunConfigured=!0}return t.preset!==void 0?(this.environmentPresetOptions={...t,sunPosition:this.sunDirection.clone()},this.#n(this.environmentPresetOptions),this.sunConfigured=!0):e&&this.environmentPresetOptions&&(this.environmentPresetOptions.sunPosition=this.sunDirection.clone(),t.environmentTexture||this.refreshEnvironment()),this.sunConfigured&&this.#s(),t.background!==void 0&&(this.scene.background=t.background===null?null:new zt(t.background)),t.environmentTexture&&(t.environmentTexture.mapping=Jr,this.#r(),this.scene.environment=t.environmentTexture),t.backgroundTexture&&(t.backgroundTexture.mapping=Jr,this.#o(),this.scene.background=t.backgroundTexture),t.environmentIntensity!==void 0&&(this.scene.environmentIntensity=Number(t.environmentIntensity)),t.backgroundIntensity!==void 0&&(this.scene.backgroundIntensity=Number(t.backgroundIntensity)),t.backgroundBlurriness!==void 0&&(this.scene.backgroundBlurriness=Number(t.backgroundBlurriness)),t.backgroundRotationDegrees!==void 0&&this.scene.backgroundRotation.set(0,Yh.degToRad(Number(t.backgroundRotationDegrees)),0),t.environmentRotationDegrees!==void 0&&this.scene.environmentRotation.set(0,Yh.degToRad(Number(t.environmentRotationDegrees)),0),t.toneMapping&&Object.hasOwn(Tl,t.toneMapping)&&(this.options.toneMapping=t.toneMapping,this.renderer&&(this.renderer.toneMapping=Tl[t.toneMapping])),t.toneMappingExposure!==void 0&&(this.options.toneMappingExposure=Number(t.toneMappingExposure),this.renderer&&(this.renderer.toneMappingExposure=this.options.toneMappingExposure)),this}getSunDirection(){return this.sunDirection.clone()}getSunPosition(t=100){return this.sunDirection.clone().multiplyScalar(Number(t)||1)}#n(t,e=!1){const i=String(t.preset??"none").toLowerCase(),n=this.skyDome?.userData?.uniforms?.uTime?.value??0;if(i===Yn.NONE){this.#r(),this.#o(),this.scene.environment=null,this.environmentPresetOptions=null;return}if(!this.renderer)throw new Error("init() must run before an environment preset is set");const s=new Jh(this.renderer);let a=null,o=null;const l=i===Yn.SKY||i===Yn.GRADIENT;try{if(i===Yn.SKY){o=new la,o.scale.setScalar(this.options.far*.9);const d=t.sunPosition??{x:.4,y:.22,z:-1},u=new B(d.x,d.y,d.z).normalize();this.sunDirection.copy(u),o.material.uniforms.sunPosition.value.copy(u),o.material.uniforms.turbidity.value=Number(t.turbidity??6),o.material.uniforms.rayleigh.value=Number(t.rayleigh??2),o.material.uniforms.mieCoefficient.value=Number(t.mieCoefficient??.005),o.material.uniforms.mieDirectionalG.value=Number(t.mieDirectionalG??.8),a=new wo,a.add(o)}else if(i===Yn.GRADIENT){const d=ed({...t.sky??{},radius:50,sunDirection:t.sunPosition??this.sunDirection});d.material.depthTest=!0,d.material.depthWrite=!0,d.material.toneMapped=!1,d.userData.uniforms.uTime.value=n,d.userData.update(0,this.wind),d.onBeforeRender=()=>{},a=new wo,a.add(d)}else if(i===Yn.ROOM)a=new kv;else throw new Error(`Unknown environment preset ${String(t.preset)}; expected room, sky, gradient, or none`);const h=s.fromScene(a,.04),c=this.scene.background===this.generatedEnvironment;this.#r(),this.generatedEnvironmentTarget=h,this.generatedEnvironment=h.texture,this.scene.environment=h.texture,this.environmentAge=0,this.scene.environmentRotation.set(0,0,0),e?c&&(this.scene.background=h.texture):l&&t.showSky!==!1?i===Yn.GRADIENT?(this.#a(t),this.skyDome.userData.uniforms.uTime.value=n):this.#t(t):(this.#o(),t.background===void 0&&(this.scene.background=h.texture))}finally{a?.traverse?.(h=>{h.geometry?.dispose?.();const c=Array.isArray(h.material)?h.material:h.material?[h.material]:[];for(const d of c)d.dispose?.()}),s.dispose()}}#a(t){this.#o();const e=ed({...t.sky??{},radius:Number(t.sky?.radius??this.options.far*.92),sunDirection:t.sunPosition??this.sunDirection});return t.sunPosition&&this.sunDirection.set(Number(t.sunPosition.x??0),Number(t.sunPosition.y??1),Number(t.sunPosition.z??0)).normalize(),e.userData.setSunDirection(this.sunDirection),this.skyDome=e,this.add(e,"sky"),this.scene.background=null,e}#o(){const t=this.namedRoots.get("sky");t&&(sd(t),this.namedRoots.delete("sky")),this.skyDome=null}#t(t){this.#o();const e=new la;e.scale.setScalar(this.options.far*.9);const i=t.sunPosition??{x:.4,y:.22,z:-1};return this.sunDirection.set(i.x,i.y,i.z).normalize(),e.material.uniforms.sunPosition.value.copy(this.sunDirection),e.material.uniforms.turbidity.value=Number(t.turbidity??6),e.material.uniforms.rayleigh.value=Number(t.rayleigh??2),e.material.uniforms.mieCoefficient.value=Number(t.mieCoefficient??.005),e.material.uniforms.mieDirectionalG.value=Number(t.mieDirectionalG??.8),e.name="A3GameSky",this.skyDome=e,this.add(e,"sky"),this.scene.background=null,e}#r(){this.generatedEnvironment&&(this.scene?.background===this.generatedEnvironment&&(this.scene.background=null),this.generatedEnvironmentTarget?this.generatedEnvironmentTarget.dispose():this.generatedEnvironment.dispose(),this.generatedEnvironmentTarget=null,this.generatedEnvironment=null)}setFog(t={}){if(!this.scene)throw new Error("init() must run before setFog()");const e=t.type??"none";if(e==="none")return this.scene.fog=null,this;const i=new zt(t.color??1052692);return this.scene.fog=e==="FogExp2"?new Sc(i,t.density??.001):new wc(i,t.near??1,t.far??200),this}raycastFromPointer(t,e){if(!this.renderer||!this.camera)return null;const i=this.renderer.domElement.getBoundingClientRect();this.pointer.x=(t.clientX-i.left)/i.width*2-1,this.pointer.y=-((t.clientY-i.top)/i.height)*2+1,this.raycaster.setFromCamera(this.pointer,this.camera);const n=this.raycaster.intersectObjects(e??this.scene.children,!0);return n.length>0?n[0]:null}raycast(t,e,i={}){return this.raycaster.set(t,e.clone().normalize()),this.raycaster.near=i.near??0,this.raycaster.far=i.far??1/0,this.raycaster.intersectObjects(i.targets??this.scene.children,!0)}captureFrame(){return this.#i(0),this.renderer?.domElement.toDataURL("image/png")??""}getStats(){const t=this.renderer?.info;return{frameCount:this.frameCount,elapsedSeconds:Number(this.elapsedSeconds.toFixed(3)),simulationSteps:this.lastSubSteps,interpolationAlpha:this.interpolationAlpha,droppedSeconds:this.droppedSeconds,drawCalls:t?.render?.calls??0,triangles:t?.render?.triangles??0,geometries:t?.memory?.geometries??0,textures:t?.memory?.textures??0,programs:t?.programs?.length??0,pixelRatio:this.renderer?.getPixelRatio()??0,size:this.#l()}}dispose(){this.stop(),this.detachControls(),this.tickListeners.clear(),this.renderListeners.clear(),this.interpolatedObjects.clear(),this.sunLights.clear(),this.environmentPresetOptions=null,this.resizeListeners.clear(),this.onWindowResize&&(window.removeEventListener("resize",this.onWindowResize),this.onWindowResize=null),this.resizeObserver?.disconnect(),this.resizeObserver=null,this.#r(),this.skyDome=null,this.scene&&sd(this.scene),this.scene=null,this.namedRoots.clear(),this.renderer&&(this.renderer.dispose(),this.renderer.domElement.remove(),this.renderer=null),this.camera=null}#u(t){this.wind.update(t),this.skyDome?.userData?.update?.(t,this.wind);for(const e of this.tickListeners)e(t,this.elapsedSeconds)}#l(){const t=this.container?.clientWidth||globalThis.window?.innerWidth||1,e=this.container?.clientHeight||globalThis.window?.innerHeight||1;return{width:t,height:e,clientWidth:t,clientHeight:e}}#h(t,e){if(t==="orthographic"){const i=this.options.frustumHeight/2,n=i*e;return new Ac(-n,n,i,-i,this.options.near,this.options.far)}return new hi(this.options.fov,e,this.options.near,this.options.far)}#c(t){if(!this.scene)throw new Error("init() must run before switching cameras");const{width:e,height:i}=this.#l(),n=this.camera,s=this.#h(t,e/Math.max(1,i));if(s.name=n?.name??"A3GameCamera",n){s.position.copy(n.position),s.quaternion.copy(n.quaternion);const a=n.parent;n.removeFromParent?.(),a&&a.add(s)}return this.camera=s,this.controls?.object&&(this.controls.object=s),this.#d(),s}#d(){const{width:t,height:e}=this.#l();if(!this.camera||!this.renderer)return{width:t,height:e};const i=t/Math.max(1,e);if(this.camera.isOrthographicCamera){const n=this.options.frustumHeight/2,s=n*i;this.camera.left=-s,this.camera.right=s,this.camera.top=n,this.camera.bottom=-n}else this.camera.aspect=i;return this.camera.updateProjectionMatrix(),this.renderer.setSize(t,e),{width:t,height:e}}#f(){const t=()=>{const e=this.#d();for(const i of this.resizeListeners)i(e)};this.onWindowResize=t,window.addEventListener("resize",t),typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(t),this.resizeObserver.observe(this.container)),t()}}function sd(r){if(!r)return;const t=["map","normalMap","roughnessMap","metalnessMap","aoMap","emissiveMap","alphaMap","displacementMap","envMap","lightMap","clearcoatMap","sheenColorMap"],e=new Set,i=n=>{!n||e.has(n)||n.userData?.a3AssetLibraryOwned||(e.add(n),n.dispose?.())};r.traverse(n=>{if(n.userData?.dispose?.(),n.userData?.disposed)return;n.isLight&&n.dispose?.(),i(n.geometry);const s=Array.isArray(n.material)?n.material:n.material?[n.material]:[];for(const a of s){for(const o of t)i(a[o]);i(a)}}),r.parent?.remove(r),r.clear?.()}const rd="a3game-hud-style",Wv=`
.a3game-hud-root { position:absolute; inset:0; pointer-events:none;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color:#f3f5f8; text-shadow:0 1px 2px rgba(0,0,0,.6); }
.a3game-hud-slot { position:absolute; display:flex; flex-direction:column;
  gap:6px; pointer-events:none; max-width:calc(100% - 32px); }
.a3game-hud-slot[data-a3game-anchor="top-left"] { top:16px; left:16px;
  align-items:flex-start; }
.a3game-hud-slot[data-a3game-anchor="top-center"] { top:16px; left:50%;
  transform:translateX(-50%); align-items:center; }
.a3game-hud-slot[data-a3game-anchor="top-right"] { top:16px; right:16px;
  align-items:flex-end; }
.a3game-hud-slot[data-a3game-anchor="center"] { top:50%; left:50%;
  transform:translate(-50%,-50%); align-items:center; justify-content:center; }
.a3game-hud-slot[data-a3game-anchor="bottom-left"] { bottom:16px; left:16px;
  align-items:flex-start; }
.a3game-hud-slot[data-a3game-anchor="bottom-center"] { bottom:16px; left:50%;
  transform:translateX(-50%); align-items:center; }
.a3game-hud-slot[data-a3game-anchor="bottom-right"] { bottom:16px; right:16px;
  align-items:flex-end; }
.a3game-hud-widget { position:relative; pointer-events:none;
  font-size:14px; line-height:1.4; white-space:pre-line; }
.a3game-hud-bar { width:180px; height:10px; border-radius:5px;
  background:rgba(255,255,255,.18); overflow:hidden; }
.a3game-hud-bar > i { display:block; height:100%; width:0%;
  background:linear-gradient(90deg,#4ade80,#22d3ee); transition:width .12s; }
.a3game-hud-crosshair { width:18px; height:18px; }
.a3game-hud-crosshair::before, .a3game-hud-crosshair::after {
  content:''; position:absolute; background:rgba(255,255,255,.85); }
.a3game-hud-crosshair::before { left:8px; top:0; width:2px; height:18px; }
.a3game-hud-crosshair::after { top:8px; left:0; height:2px; width:18px; }
.a3game-hud-widget[data-a3game-kind="panel"] { padding:10px 14px;
  border-radius:8px; background:rgba(12,14,20,.62);
  border:1px solid rgba(255,255,255,.14); max-width:340px; }
.a3game-hud-widget[data-a3game-kind="banner"] { padding:18px 28px;
  border-radius:12px; background:rgba(12,14,20,.78); font-size:22px;
  font-weight:600; text-align:center;
  border:1px solid rgba(255,255,255,.18); }
`,Xv=new Set(["top-left","top-center","top-right","center","bottom-left","bottom-center","bottom-right"]),qv=r=>r?typeof r=="string"?document.querySelector(r):r:null;class $v{constructor(t={}){const e=qv(t.container);if(!e)throw new Error("A3GameHudLayer requires an existing container");this.container=e,this.root=document.createElement("div"),this.root.className="a3game-hud-root",this.root.dataset.a3gameHud="root",this.container.appendChild(this.root),this.widgets=new Map,this.slots=new Map,this.fadeTasks=new Map,this.#s()}addText(t,e={}){return this.#e(t,"text",e),this.setValue(t,e.value??""),this.widgets.get(String(t)).element}addBar(t,e={}){const i=this.#e(t,"bar",e);if(i.innerHTML="",e.label){const s=document.createElement("span");s.textContent=String(e.label),i.appendChild(s)}const n=document.createElement("div");return n.className="a3game-hud-bar",n.appendChild(document.createElement("i")),i.appendChild(n),this.setValue(t,Number(e.value??1)),i}addCrosshair(t="crosshair"){const e=this.#e(t,"crosshair",{anchor:"center"});return e.classList.add("a3game-hud-crosshair"),e}addPanel(t,e={}){return this.#e(t,"panel",e),this.setValue(t,e.value??""),this.widgets.get(String(t)).element}addBanner(t,e={}){const i=this.#e(t,"banner",{anchor:e.anchor??"center"});return this.setValue(t,e.value??""),this.setVisible(t,e.visible!==!1),i}setValue(t,e){const i=this.widgets.get(String(t));if(!i)return!1;const{element:n,kind:s}=i;if(s==="bar"){const a=Math.max(0,Math.min(1,Number(e)||0)),o=n.querySelector(".a3game-hud-bar > i");return o&&(o.style.width=`${(a*100).toFixed(1)}%`),n.dataset.a3gameValue=a.toFixed(4),!0}return(s==="text"||s==="panel"||s==="banner")&&(n.textContent=String(e??"")),n.dataset.a3gameValue=String(e??""),!0}setValues(t={}){for(const[e,i]of Object.entries(t))this.setValue(e,i);return this}setVisible(t,e){const i=String(t),n=this.widgets.get(i);return n?(this.fadeTasks.get(i)?.(),n.element.style.display=e?"":"none",n.element.style.opacity=e?"1":"0",n.element.style.pointerEvents="",n.element.dataset.a3gameVisible=e?"true":"false",n.element.dataset.a3gameFaded="false",!0):!1}remove(t){const e=String(t),i=this.widgets.get(e);return i?(this.fadeTasks.get(e)?.(),i.element.remove(),this.widgets.delete(e),!0):!1}autoHide(t,e={}){const i=String(t),n=this.widgets.get(i);if(!n)return()=>{};const s=Number(e.after??6),a=Number(e.fade??.8);if(![s,a].every(u=>Number.isFinite(u)&&u>=0))throw new RangeError("autoHide after/fade must be finite non-negative seconds");if(e.host&&typeof e.host.onRender!="function")throw new TypeError("autoHide host requires onRender");this.setVisible(i,!0),n.element.style.transition="none";let o=0,l=()=>{},h=!1;const c=()=>{h||(h=!0,l(),this.fadeTasks.get(i)===c&&this.fadeTasks.delete(i))},d=u=>{if(h)return;o+=Math.max(0,Number(u)||0);const f=o<s?1:a>0?Math.max(0,1-(o-s)/a):0;n.element.style.opacity=String(f),f<=1e-8&&(n.element.style.display="none",n.element.dataset.a3gameVisible="false",n.element.dataset.a3gameFaded="true",c())};if(this.fadeTasks.set(i,c),e.host)l=e.host.onRender(d);else{let u=performance.now();const f=setInterval(()=>{const p=performance.now();d((p-u)/1e3),u=p},16);l=()=>clearInterval(f)}return d(0),c}getState(){const t={};for(const[e,i]of this.widgets)t[e]={kind:i.kind,value:i.element.dataset.a3gameValue??"",visible:i.element.style.display!=="none"&&i.element.style.opacity!=="0",anchor:i.element.dataset.a3gameAnchor??""};return t}dispose(){for(const t of this.fadeTasks.values())t();this.fadeTasks.clear(),this.widgets.clear(),this.slots.clear(),this.root.remove()}#e(t,e,i){const n=String(t);this.remove(n);const s=Xv.has(i.anchor)?i.anchor:"top-left",a=document.createElement("div");return a.className=`a3game-hud-widget ${i.className??""}`.trim(),a.dataset.a3gameWidget=n,a.dataset.a3gameKind=e,a.dataset.a3gameAnchor=s,this.#i(s).appendChild(a),this.widgets.set(n,{element:a,kind:e}),a}#i(t){const e=this.slots.get(t);if(e)return e;const i=document.createElement("div");return i.className="a3game-hud-slot",i.dataset.a3gameAnchor=t,this.root.appendChild(i),this.slots.set(t,i),i}#s(){if(document.getElementById(rd))return;const t=document.createElement("style");t.id=rd,t.textContent=Wv,document.head.appendChild(t)}}const Lr=(r,t)=>Number.isFinite(Number(r))?Number(r):t,Oa=(r,t="")=>typeof r=="string"&&r.length>0?r:t;function Yv(r={}){const t=e=>Math.max(-1,Math.min(1,Lr(e,0)));return{worldId:Oa(r.worldId),participantId:Oa(r.participantId),controllerId:Oa(r.controllerId),entityId:Oa(r.entityId),moveX:t(r.moveX),moveY:t(r.moveY),run:!!r.run,jump:!!r.jump,yaw:Lr(r.yaw,0),pitch:Lr(r.pitch,0),sequence:Math.trunc(Lr(r.sequence,0)),timestampSeconds:Lr(r.timestampSeconds,performance.now()/1e3)}}const Zv=Object.freeze({KeyW:"forward",ArrowUp:"forward",KeyS:"backward",ArrowDown:"backward",KeyA:"left",ArrowLeft:"left",KeyD:"right",ArrowRight:"right",ShiftLeft:"run",ShiftRight:"run",Space:"jump"}),Kv=new Set(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]),To=Object.freeze({POINTER_LOCK:"pointer-lock",DRAG:"drag",ALWAYS:"always"});class Jv{constructor(t={}){this.target=t.target??window,this.controllerId=String(t.controllerId??""),this.keyBindings={...Zv,...t.keyBindings??{}},this.actionBindings={...t.actionBindings??{}},this.pointerSensitivity=Number(t.pointerSensitivity??.0025),this.invertPitch=!!t.invertPitch,this.maxPitch=Number(t.maxPitch??Math.PI/2-.05),this.lookMode=String(t.lookMode??To.POINTER_LOCK),this.gamepadIndex=t.gamepadIndex??null,this.axes={forward:0,backward:0,left:0,right:0},this.run=!1,this.jump=!1,this.yaw=0,this.pitch=0,this.sequence=0,this.enabled=!1,this.pointerDown=!1,this.pressedActions=new Set,this.actionListeners=new Set,this.teardown=[]}enable(){if(this.enabled)return this;this.enabled=!0;const t=(e,i,n,s)=>{e.addEventListener(i,n,s),this.teardown.push(()=>e.removeEventListener(i,n,s))};return t(window,"keydown",e=>this.#e(e,!0)),t(window,"keyup",e=>this.#e(e,!1)),t(window,"blur",()=>this.reset()),this.target!==window&&(t(this.target,"pointermove",e=>this.#s(e)),t(this.target,"pointerdown",e=>this.#i(e,!0)),t(this.target,"pointerup",e=>this.#i(e,!1)),t(this.target,"contextmenu",e=>e.preventDefault()),t(window,"pointerup",e=>this.#i(e,!1)),t(window,"pointercancel",()=>{this.pointerDown=!1})),this}disable(){for(const t of this.teardown)t();return this.teardown=[],this.enabled=!1,this.reset(),this}reset(){return this.axes={forward:0,backward:0,left:0,right:0},this.run=!1,this.jump=!1,this.pointerDown=!1,this.pressedActions.clear(),this}setLook(t,e=this.pitch){return this.yaw=Number(t)||0,this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,Number(e)||0)),this}onAction(t){if(typeof t!="function")throw new TypeError("onAction requires a function");return this.actionListeners.add(t),()=>this.actionListeners.delete(t)}isActionHeld(t){return this.pressedActions.has(String(t))}sample(t={}){this.#a();const e=this.axes.forward-this.axes.backward,i=this.axes.right-this.axes.left,n=this.jump;return this.jump=!1,this.sequence+=1,Yv({worldId:t.worldId,participantId:t.participantId,controllerId:t.controllerId??this.controllerId,entityId:t.entityId,moveX:i,moveY:e,run:this.run,jump:n,yaw:this.yaw,pitch:this.pitch,sequence:this.sequence})}pipeToSession(t,e,i){return e.onTick(()=>{t.enqueueInputState(this.sample(i))})}#e(t,e){const i=this.keyBindings[t.code];i&&(i==="run"?this.run=e:i==="jump"?(e&&!this.pressedActions.has("jump")&&(this.jump=!0),this.#n("jump",e)):i in this.axes&&(this.axes[i]=e?1:0),Kv.has(t.code)&&t.preventDefault());const n=this.actionBindings[t.code];n&&this.#n(n,e)}#i(t,e){this.pointerDown=e?!0:(t.buttons??0)!==0;const i=this.actionBindings[`Mouse${t.button}`]??(t.button===0?"primary":t.button===2?"secondary":"");i&&this.#n(i,e)}#s(t){if(this.lookMode===To.POINTER_LOCK){if(!document.pointerLockElement)return}else if(this.lookMode===To.DRAG&&!this.pointerDown)return;const e=Number(t.movementX??0),i=Number(t.movementY??0);if(e===0&&i===0)return;this.yaw-=e*this.pointerSensitivity;const n=this.invertPitch?1:-1;this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,this.pitch+n*i*this.pointerSensitivity))}#n(t,e){const i=String(t),n=this.pressedActions.has(i);if(e&&!n){this.pressedActions.add(i);for(const s of this.actionListeners)s(i,"pressed")}else if(!e&&n){this.pressedActions.delete(i);for(const s of this.actionListeners)s(i,"released")}}#a(){if(this.gamepadIndex===null)return;const e=(navigator.getGamepads?.()??[])[this.gamepadIndex];if(!e)return;const i=.15,n=o=>Math.abs(o)<i?0:o,s=n(e.axes[0]??0),a=n(e.axes[1]??0);this.axes.right=Math.max(0,s),this.axes.left=Math.max(0,-s),this.axes.forward=Math.max(0,-a),this.axes.backward=Math.max(0,a),this.yaw-=n(e.axes[2]??0)*.04,this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,this.pitch-n(e.axes[3]??0)*.04)),this.run=!!e.buttons[10]?.pressed,e.buttons[0]?.pressed&&!this.pressedActions.has("jump")&&(this.jump=!0),this.#n("jump",!!e.buttons[0]?.pressed),this.#n("primary",!!e.buttons[7]?.pressed),this.#n("secondary",!!e.buttons[6]?.pressed)}}const ad=.9,Yr=1e-4;function Al(r=2654435769){let t=r>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}const od=r=>Math.max(Yr,r);class Qv{constructor({context:t=null,drone:e=!0}={}){this.ctx=null,this.muted=!1,this.useDrone=e,this.rand=Al(),this.charge=null,this.listener={x:0,y:0,z:0,yaw:0},this.#c(),t&&this.#e(t)}unlock(){if(this.ctx){this.ctx.state==="suspended"&&this.ctx.resume&&this.ctx.resume();return}const t=globalThis.AudioContext??globalThis.webkitAudioContext;t&&this.#e(new t)}setMuted(t){this.muted=!!t,this.master&&this.master.gain.setTargetAtTime(this.muted?0:ad,this.ctx.currentTime,.05)}setListener(t,e,i,n=0){if(this.listener={x:t,y:e,z:i,yaw:n},!this.ctx)return;const s=this.ctx.listener,a=-Math.sin(n),o=-Math.cos(n);if(s.positionX){const l=this.ctx.currentTime;s.positionX.setValueAtTime(t,l),s.positionY.setValueAtTime(e,l),s.positionZ.setValueAtTime(i,l),s.forwardX.setValueAtTime(a,l),s.forwardY.setValueAtTime(0,l),s.forwardZ.setValueAtTime(o,l),s.upX.setValueAtTime(0,l),s.upY.setValueAtTime(1,l),s.upZ.setValueAtTime(0,l)}else s.setPosition?.(t,e,i),s.setOrientation?.(a,0,o,0,1,0)}#e(t){this.ctx=t,this.limiter=t.createDynamicsCompressor(),this.limiter.threshold.value=-6,this.limiter.knee.value=0,this.limiter.ratio.value=20,this.limiter.attack.value=.001,this.limiter.release.value=.12,this.master=t.createGain(),this.master.gain.value=this.muted?0:ad,this.limiter.connect(this.master).connect(t.destination),this.bus=t.createGain(),this.bus.connect(this.limiter),this.dry=t.createGain(),this.dry.connect(this.bus),this.reverb=t.createConvolver(),this.reverb.buffer=this.#i(3.2,2.6),this.wet=t.createGain(),this.wet.gain.value=.5,this.reverb.connect(this.wet).connect(this.bus),this.brown=this.#s(3,!0),this.white=this.#s(2,!1),this.setListener(this.listener.x,this.listener.y,this.listener.z,this.listener.yaw),this.useDrone&&this.#u()}#i(t,e){const{ctx:i}=this,n=Math.floor(i.sampleRate*t),s=i.createBuffer(2,n,i.sampleRate),a=Al(1234);for(let o=0;o<2;o+=1){const l=s.getChannelData(o),h=Math.floor(i.sampleRate*.012);let c=0;for(let d=h;d<n;d+=1){const u=d/n,f=.25+.7*u;c+=(1-f)*(a()*2-1-c),l[d]=c*(1-u)**e}}return s}#s(t,e){const{ctx:i}=this,n=Math.floor(i.sampleRate*t),s=i.createBuffer(1,n,i.sampleRate),a=s.getChannelData(0),o=Al(e?77:99);let l=0,h=0;for(let c=0;c<n;c+=1){const d=o()*2-1;e?(l=(l+.02*d)/1.02,a[c]=l):a[c]=d,h=Math.max(h,Math.abs(a[c]))}for(let c=0;c<n;c+=1)a[c]/=h||1;return s}#n(){return this.ctx.currentTime+.005}#a(t,{pos:e=null,pan:i=0,wet:n=.5,dry:s=1}={}){const{ctx:a}=this;let o=t;if(e){const l=a.createPanner();l.panningModel="HRTF",l.distanceModel="inverse",l.refDistance=1.5,l.rolloffFactor=1.1,l.maxDistance=60,l.positionX?(l.positionX.value=e.x??0,l.positionY.value=e.y??0,l.positionZ.value=e.z??0):l.setPosition(e.x??0,e.y??0,e.z??0),t.connect(l),o=l}else if(i){const l=a.createStereoPanner();l.pan.value=Math.max(-1,Math.min(1,i)),t.connect(l),o=l}if(s>0){const l=a.createGain();l.gain.value=s,o.connect(l).connect(this.dry)}if(n>0){const l=a.createGain();l.gain.value=n,o.connect(l).connect(this.reverb)}}#o(t,{gain:e,attack:i=.005,dur:n,hold:s=0}){const a=this.ctx.createGain();return a.gain.setValueAtTime(Yr,t),a.gain.exponentialRampToValueAtTime(od(e),t+i),s>0&&a.gain.setValueAtTime(od(e),t+i+s),a.gain.exponentialRampToValueAtTime(Yr,t+Math.max(n,i+s+.01)),a}#t({type:t="sine",f0:e,f1:i=e,t:n=0,dur:s,gain:a,attack:o=.005,hold:l=0,dest:h=null,...c}){const{ctx:d}=this,u=this.#n()+n,f=d.createOscillator();f.type=t,f.frequency.setValueAtTime(e,u),i!==e&&f.frequency.exponentialRampToValueAtTime(Math.max(20,i),u+s);const p=this.#o(u,{gain:a,attack:o,dur:s,hold:l});f.connect(p),h?p.connect(h):this.#a(p,c),f.start(u),f.stop(u+s+.05)}#r({brown:t=!1,t:e=0,dur:i,gain:n,attack:s=.005,hold:a=0,filter:o="bandpass",freq:l=1e3,freq1:h=l,q:c=1,dest:d=null,...u}){const{ctx:f}=this,p=this.#n()+e,x=t?this.brown:this.white,m=f.createBufferSource();m.buffer=x,m.loop=!0;const g=f.createBiquadFilter();g.type=o,g.Q.value=c,g.frequency.setValueAtTime(l,p),h!==l&&g.frequency.exponentialRampToValueAtTime(Math.max(20,h),p+i);const v=this.#o(p,{gain:n,attack:s,dur:i,hold:a});m.connect(g).connect(v),d?v.connect(d):this.#a(v,u),m.start(p,this.rand()*(x.duration-.1)),m.stop(p+i+.05)}#u(){const{ctx:t}=this,e=t.createGain();e.gain.value=.025;for(const o of[55,55.6,82.4]){const l=t.createOscillator();l.frequency.value=o,l.connect(e),l.start()}const i=t.createBufferSource();i.buffer=this.brown,i.loop=!0;const n=t.createBiquadFilter();n.type="lowpass",n.frequency.value=220;const s=t.createGain();s.gain.value=.035,i.connect(n).connect(s).connect(this.bus),i.start(),e.connect(this.bus);const a=t.createGain();a.gain.value=.3,e.connect(a).connect(this.reverb)}#l(t,{t:e=0,spread:i=.35,gain:n=.05,low:s=280,high:a=900,...o}={}){for(let l=0;l<t;l+=1){const h=s+this.rand()*(a-s);this.#t({f0:h,f1:h*1.9,t:e+this.rand()*i,dur:.05+this.rand()*.05,gain:n*(.5+this.rand()*.5),attack:.004,...o})}}pulse(t,e=1,{wet:i=!1}={}){if(!this.ctx)return;this.stopCharge();const{ctx:n}=this,s=n.createGain();if(i){const a=n.createBiquadFilter();a.type="lowpass",a.frequency.value=900,a.Q.value=6;const o=n.createOscillator();o.frequency.value=7;const l=n.createGain();l.gain.value=300,o.connect(l).connect(a.frequency);const h=this.#n();o.start(h),o.stop(h+2),s.connect(a);const c=n.createGain();c.gain.value=1.6,a.connect(c),this.#a(c,{wet:.7})}else this.#a(s,{wet:t==="tap"?.35:.8});if(t==="tap")this.#t({f0:2100,f1:1500,dur:.09,gain:.42,dest:s}),this.#t({f0:1500,f1:1200,t:.16,dur:.07,gain:.1,dest:s});else{const a=Math.max(0,Math.min(1,e)),o=t==="full"?.4+a*.25:.28+a*.15;this.#t({f0:1300,f1:520,dur:.5,gain:o,dest:s}),this.#t({type:"triangle",f0:260,f1:110,dur:.6,gain:o*.8,dest:s}),t==="full"&&this.#t({f0:90,f1:45,dur:.5,gain:o*.6,dest:s});for(let l=1;l<=3;l+=1)this.#t({f0:1100-l*120,f1:500,t:.22*l+a*.2,dur:.35,gain:o*.35/l,pan:l%2?-.5:.5,wet:1})}i&&(this.#l(t==="tap"?4:10,{gain:t==="tap"?.06:.1,spread:t==="tap"?.2:.5,wet:.4}),this.#r({dur:.35,gain:t==="tap"?.05:.12,filter:"lowpass",freq:1200,freq1:300,wet:.4}))}startCharge(){if(!this.ctx||this.charge)return;const{ctx:t}=this,e=t.currentTime,i=t.createOscillator();i.type="sine",i.frequency.setValueAtTime(300,e),i.frequency.linearRampToValueAtTime(900,e+1.1);const n=t.createOscillator();n.type="triangle",n.frequency.setValueAtTime(150,e),n.frequency.linearRampToValueAtTime(450,e+1.1);const s=t.createGain();s.gain.value=.4,n.connect(s);const a=t.createGain();a.gain.value=.8;const o=t.createOscillator();o.frequency.setValueAtTime(4,e),o.frequency.linearRampToValueAtTime(14,e+1.1);const l=t.createGain();l.gain.value=.2,o.connect(l).connect(a.gain);const h=t.createGain();h.gain.setValueAtTime(Yr,e),h.gain.exponentialRampToValueAtTime(.14,e+.25),i.connect(a),s.connect(a),a.connect(h),this.#a(h,{wet:.3});for(const c of[i,n,o])c.start(e);this.charge={nodes:[i,n,o],g:h}}stopCharge(){if(!this.charge||!this.ctx)return;const{nodes:t,g:e}=this.charge,i=this.ctx.currentTime;e.gain.cancelScheduledValues(i),e.gain.setTargetAtTime(Yr,i,.02);for(const n of t)n.stop(i+.15);this.charge=null}crystalEcho(t){if(!this.ctx)return;const e=1568;[[1,.32],[2.76,.17],[5.4,.09],[8.93,.045]].forEach(([i,n],s)=>{this.#t({f0:e*i,f1:e*i*.997,t:s*.012,dur:1.6-s*.25,gain:n,attack:.003,pos:t,wet:.8})}),this.#t({f0:e*1.5,t:.14,dur:1,gain:.11,attack:.02,pos:t,wet:.9})}growl(t,{short:e=!1,big:i=!1}={}){if(!this.ctx)return;const{ctx:n}=this,s=this.#n(),a=i?e?.9:2.6:e?.5:1.4,o=i?1.5:e?1:.9,l=i?e?60:36:e?95:58,h=i?e?48:54:e?70:82,c=n.createOscillator();c.type="sawtooth",c.frequency.setValueAtTime(l,s),c.frequency.linearRampToValueAtTime(h,s+a*.6),c.frequency.linearRampToValueAtTime(i?30:48,s+a);const d=n.createOscillator();d.type="sine",d.frequency.setValueAtTime(l/2,s),d.frequency.linearRampToValueAtTime(h/2,s+a*.6);const u=n.createGain();u.gain.value=i?.8:.3,d.connect(u);const f=n.createOscillator();f.frequency.value=i?17:23;const p=n.createGain();p.gain.value=i?12:18,f.connect(p).connect(c.frequency);const x=n.createGain();x.gain.value=.75;const m=n.createOscillator();m.frequency.value=i?9:13;const g=n.createGain();g.gain.value=.25,m.connect(g).connect(x.gain);const v=n.createBufferSource();v.buffer=this.brown,v.loop=!0;const S=n.createGain();S.gain.value=.7;const _=n.createBiquadFilter();_.type="lowpass",_.frequency.setValueAtTime(i?380:520,s),_.frequency.linearRampToValueAtTime(i?650:800,s+a*.5),_.frequency.linearRampToValueAtTime(i?250:400,s+a),_.Q.value=2;const E=this.#o(s,{gain:o,attack:i?.25:.1,dur:a,hold:a*.25});c.connect(_),v.connect(S).connect(_),_.connect(x),u.connect(x),x.connect(E),this.#a(E,{pos:t,wet:i?.7:.5});for(const b of[c,d,f,m])b.start(s),b.stop(s+a+.1);v.start(s,this.rand()*2),v.stop(s+a+.1)}huff(t){this.ctx&&(this.#r({brown:!0,dur:.45,gain:.7,attack:.06,filter:"bandpass",freq:500,freq1:260,q:1.4,pos:t,wet:.4}),this.#r({brown:!0,t:.55,dur:.6,gain:.5,attack:.1,filter:"bandpass",freq:380,freq1:200,q:1.4,pos:t,wet:.4}),this.#t({type:"sawtooth",f0:70,f1:55,t:.55,dur:.5,gain:.05,attack:.08,pos:t,wet:.3}))}chime(t=0){if(!this.ctx)return;const e=1046.5*2**(t%8*2/12);[1,1.26,1.5,2].forEach((i,n)=>this.#t({f0:e*i,dur:1.2,gain:.1,t:n*.07,wet:.8}))}twinkle(t){this.ctx&&(this.#t({f0:2637,dur:.4,gain:.06,pos:t,wet:.9}),this.#t({f0:3322,t:.09,dur:.35,gain:.045,pos:t,wet:.9}))}drip(t){if(!this.ctx)return;const e=1300+this.rand()*900,i=.2+this.rand()*.1;this.#t({f0:e*.6,f1:e*1.3,dur:.03,gain:i*.6,attack:.002,pos:t,wet:1}),this.#t({f0:e,f1:e*.45,t:.025,dur:.12,gain:i,attack:.002,pos:t,wet:1})}wade(t=.5){if(!this.ctx)return;const e=.5+Math.max(0,Math.min(1,t))*.5;this.#r({dur:.28,gain:.08*e,attack:.01,filter:"bandpass",freq:1400,freq1:400,q:.8,pan:(this.rand()-.5)*.3,wet:.35}),this.#r({brown:!0,dur:.2,gain:.12*e,attack:.008,filter:"lowpass",freq:500,wet:.2}),this.#l(3,{gain:.025*e,spread:.18,low:400,high:1100,wet:.3})}footstep(t=.5){if(!this.ctx)return;const e=.5+Math.max(0,Math.min(1,t))*.5;this.#r({brown:!0,dur:.09,gain:.22*e,attack:.004,filter:"lowpass",freq:380,freq1:160,pan:(this.rand()-.5)*.2,wet:.2}),this.#r({dur:.05,gain:.025*e,attack:.002,filter:"highpass",freq:2500,wet:.15})}checkpoint(){this.ctx&&[523.3,659.3,784].forEach(t=>this.#t({type:"triangle",f0:t,dur:1.6,gain:.1,attack:.08,wet:.8}))}exitOpened(){this.ctx&&[392,523.3,659.3,784,1046.5].forEach((t,e)=>this.#t({type:"triangle",f0:t,t:e*.18,dur:2.2,gain:.1,attack:.1,wet:.9}))}caught(){this.ctx&&(this.growl(null,{short:!0}),this.#t({type:"sine",f0:120,f1:30,dur:.9,gain:.5,wet:.4}),this.#r({brown:!0,dur:.6,gain:.3,attack:.01,filter:"lowpass",freq:900,freq1:150,wet:.5}))}win(){this.ctx&&[523.3,659.3,784,1046.5,1318.5,1568].forEach((t,e)=>this.#t({f0:t,t:e*.12,dur:1.8,gain:.1,wet:.9}))}surfaced(){this.ctx&&(this.#r({dur:4,gain:.05,attack:1.2,hold:1.2,filter:"bandpass",freq:900,freq1:2400,q:.6,wet:.4}),[[392,-.4],[587.3,.4],[784,-.2],[987.8,.2]].forEach(([t,e])=>{this.#t({type:"triangle",f0:t,dur:3.6,gain:.07,attack:.6,hold:1,pan:e,wet:.5})}),[1174.7,1568,1975.5,2349.3,3136].forEach((t,e)=>this.#t({f0:t,t:.4+e*.16,dur:1.4,gain:.07,pan:e%2?.5:-.5,wet:.6})))}heartbeat(t=.5){this.ctx&&this.#h(this.#n(),t)}#h(t,e){const i=.6+Math.max(0,Math.min(1,e))*.4,n=t-this.#n();this.#t({f0:70,f1:42,t:n,dur:.16,gain:.32*i,attack:.008,wet:.1}),this.#t({f0:140,f1:80,t:n,dur:.06,gain:.08*i,attack:.004,wet:.05}),this.#t({f0:62,f1:40,t:n+.28,dur:.14,gain:.24*i,attack:.008,wet:.1}),this.#t({f0:124,f1:72,t:n+.28,dur:.05,gain:.06*i,attack:.004,wet:.05})}#c(){this.nextDrip=2,this.nextTwinkle=1.5,this.nextBeatAt=0}stopAll(){this.stopCharge(),this.#c()}update(t,{playing:e,nearestMoth:i=null,dripSpot:n=null,danger:s=1/0}={}){if(!this.ctx||!e)return;if(this.nextDrip-=t,this.nextDrip<=0){this.nextDrip=1.2+this.rand()*3.8;const o=typeof n=="function"?n():null;o&&this.drip(o)}this.nextTwinkle-=t,this.nextTwinkle<=0&&(this.nextTwinkle=2.2+this.rand()*.6,i&&i.pos&&i.distance<20&&this.twinkle(i.pos));const a=this.ctx.currentTime;if(Number.isFinite(s)&&s<16){const o=Math.max(0,Math.min(1,(16-s)/14.5)),l=55+o*95;for(this.nextBeatAt<a&&(this.nextBeatAt=a+.05);this.nextBeatAt<a+.15;)this.#h(this.nextBeatAt,o),this.nextBeatAt+=60/l}else this.nextBeatAt=0}}const Cl=Math.PI*2;class jv{constructor({host:t,getScene:e,rules:i,quality:n,touch:s,reducedMotion:a,prepare:o,restore:l}){this.host=t,this.getScene=e,this.rules=i,this.quality=n,this.touch=s,this.reducedMotion=a,this.prepare=o,this.restore=l,this.active=!1,this.t=0,this.nextPulse=.8,this.savedRatio=null}get cheap(){return this.quality!=="high"||this.touch()}get still(){return this.reducedMotion}sync(t){return t&&!this.active?this.#e():!t&&this.active&&this.#s(),this.active}#e(){this.prepare();const t=this.rules;t.resetRun();const e=this.getScene();if(e.setFirstPerson(!1),e.creature.setFade(1),e.playerY=t.player.y,e.snapFacing(),this.active=!0,this.t=0,this.nextPulse=this.still?0:.8,this.pulseCount=0,this.pulse=null,this.cheap){const i=this.host.renderer;this.savedRatio=i.getPixelRatio(),i.setPixelRatio(Math.min(this.savedRatio,1))}this.still&&this.#i()}#i(){const t=this.rules,e=t.player;this.pulse={x:e.x,y:e.y+t.tuning.pulseHeight,z:e.z,radius:16,kind:"mid",wet:!1,source:"auto",time:t.clock-2.2},t.pulses.push(this.pulse)}#s(){this.active=!1;const t=this.rules;t.pulses.length=0,t.resetRun();const e=this.getScene();this.savedRatio!=null&&(this.host.renderer.setPixelRatio(this.savedRatio),this.savedRatio=null),this.restore(e)}update(t){const e=this.rules,i=this.getScene(),n=this.host.camera;if(this.still)this.pulse&&(this.pulse.time=e.clock-2.2),t=0;else{this.t+=t,this.nextPulse-=t;const s=this.cheap?8:4;if(this.nextPulse<=0&&this.pulseCount<(this.cheap?40:1e9)){this.nextPulse=s,this.pulseCount+=1;const a=e.player,o={x:a.x,y:a.y+e.tuning.pulseHeight,z:a.z,radius:this.cheap?12:14,kind:"mid",wet:!1,source:"auto",time:e.clock};e.pulses.push(o),e.pulses.length>e.tuning.maxPulses&&e.pulses.shift(),i.creature.pulse(.75)}}return this.#n(n,i),t}#n(t,e){const i=this.rules.player,n=this.still?0:this.t,s=Math.sin(n/46*Cl)*.55,a=4.6+Math.sin(n/31*Cl)*.5,o=i.facing+s,l=i.x+Math.sin(o)*a,h=i.z+Math.cos(o)*a,c=i.y+1.15+Math.sin(n/37*Cl)*.12;t.clearViewOffset(),t.position.set(l,c,h);const d=-Math.sin(i.facing)*3.2,u=-Math.cos(i.facing)*3.2;t.lookAt(i.x+d,i.y+3.7,i.z+u),t.updateMatrixWorld()}}/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const op="185",gr=0,tM=1,Mr=2,Uo=1,On=2,ld=100,hd=204,cd=205,ud=3,eM=0,lp=300,dd=1e3,ka=1001,fd=1002,pd=1003,tc=1006,iM=1008,nM=1009,hp=1015,md=1016,sM=1023,rM=1028,cp="",li="srgb",gd="srgb-linear",xd="linear",Rl="srgb",Ds=7680,yd=519,ec=35044,aM=35048,Zr=2e3,_d=2001;function oM(r){for(let t=r.length-1;t>=0;--t)if(r[t]>=65535)return!0;return!1}function vd(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}const Md={};function bd(...r){const t="THREE."+r.shift();console.log(t,...r)}function up(r){const t=r[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=r[1];e&&e.isStackTrace?r[0]+=" "+e.getLocation():r[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return r}function ke(...r){r=up(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...r)}}function In(...r){r=up(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...r)}}function ta(...r){const t=r.join(" ");t in Md||(Md[t]=!0,ke(...r))}class br{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(e)===-1&&i[t].push(e)}hasEventListener(t,e){const i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(e)!==-1}removeEventListener(t,e){const i=this._listeners;if(i===void 0)return;const n=i[t];if(n!==void 0){const s=n.indexOf(e);s!==-1&&n.splice(s,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const i=e[t.type];if(i!==void 0){t.target=this;const n=i.slice(0);for(let s=0,a=n.length;s<a;s++)n[s].call(this,t);t.target=null}}}const We=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];function Nn(){const r=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(We[r&255]+We[r>>8&255]+We[r>>16&255]+We[r>>24&255]+"-"+We[t&255]+We[t>>8&255]+"-"+We[t>>16&15|64]+We[t>>24&255]+"-"+We[e&63|128]+We[e>>8&255]+"-"+We[e>>16&255]+We[e>>24&255]+We[i&255]+We[i>>8&255]+We[i>>16&255]+We[i>>24&255]).toLowerCase()}function Kt(r,t,e){return Math.max(t,Math.min(e,r))}function lM(r,t){return(r%t+t)%t}function Pl(r,t,e){return(1-e)*r+e*t}function Oi(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function ae(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}class ne{static{ne.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,i=this.y,n=t.elements;return this.x=n[0]*e+n[3]*i+n[6],this.y=n[1]*e+n[4]*i+n[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Kt(this.x,t.x,e.x),this.y=Kt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Kt(this.x,t,e),this.y=Kt(this.y,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Kt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Kt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y;return e*e+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const i=Math.cos(e),n=Math.sin(e),s=this.x-t.x,a=this.y-t.y;return this.x=s*i-a*n+t.x,this.y=s*n+a*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Gn{constructor(t=0,e=0,i=0,n=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=i,this._w=n}static slerpFlat(t,e,i,n,s,a,o){let l=i[n+0],h=i[n+1],c=i[n+2],d=i[n+3],u=s[a+0],f=s[a+1],p=s[a+2],x=s[a+3];if(d!==x||l!==u||h!==f||c!==p){let m=l*u+h*f+c*p+d*x;m<0&&(u=-u,f=-f,p=-p,x=-x,m=-m);let g=1-o;if(m<.9995){const v=Math.acos(m),S=Math.sin(v);g=Math.sin(g*v)/S,o=Math.sin(o*v)/S,l=l*g+u*o,h=h*g+f*o,c=c*g+p*o,d=d*g+x*o}else{l=l*g+u*o,h=h*g+f*o,c=c*g+p*o,d=d*g+x*o;const v=1/Math.sqrt(l*l+h*h+c*c+d*d);l*=v,h*=v,c*=v,d*=v}}t[e]=l,t[e+1]=h,t[e+2]=c,t[e+3]=d}static multiplyQuaternionsFlat(t,e,i,n,s,a){const o=i[n],l=i[n+1],h=i[n+2],c=i[n+3],d=s[a],u=s[a+1],f=s[a+2],p=s[a+3];return t[e]=o*p+c*d+l*f-h*u,t[e+1]=l*p+c*u+h*d-o*f,t[e+2]=h*p+c*f+o*u-l*d,t[e+3]=c*p-o*d-l*u-h*f,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,i,n){return this._x=t,this._y=e,this._z=i,this._w=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const i=t._x,n=t._y,s=t._z,a=t._order,o=Math.cos,l=Math.sin,h=o(i/2),c=o(n/2),d=o(s/2),u=l(i/2),f=l(n/2),p=l(s/2);switch(a){case"XYZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"YXZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"ZXY":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"ZYX":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"YZX":this._x=u*c*d+h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d-u*f*p;break;case"XZY":this._x=u*c*d-h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d+u*f*p;break;default:ke("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const i=e/2,n=Math.sin(i);return this._x=t.x*n,this._y=t.y*n,this._z=t.z*n,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,i=e[0],n=e[4],s=e[8],a=e[1],o=e[5],l=e[9],h=e[2],c=e[6],d=e[10],u=i+o+d;if(u>0){const f=.5/Math.sqrt(u+1);this._w=.25/f,this._x=(c-l)*f,this._y=(s-h)*f,this._z=(a-n)*f}else if(i>o&&i>d){const f=2*Math.sqrt(1+i-o-d);this._w=(c-l)/f,this._x=.25*f,this._y=(n+a)/f,this._z=(s+h)/f}else if(o>d){const f=2*Math.sqrt(1+o-i-d);this._w=(s-h)/f,this._x=(n+a)/f,this._y=.25*f,this._z=(l+c)/f}else{const f=2*Math.sqrt(1+d-i-o);this._w=(a-n)/f,this._x=(s+h)/f,this._y=(l+c)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let i=t.dot(e)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Kt(this.dot(t),-1,1)))}rotateTowards(t,e){const i=this.angleTo(t);if(i===0)return this;const n=Math.min(1,e/i);return this.slerp(t,n),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const i=t._x,n=t._y,s=t._z,a=t._w,o=e._x,l=e._y,h=e._z,c=e._w;return this._x=i*c+a*o+n*h-s*l,this._y=n*c+a*l+s*o-i*h,this._z=s*c+a*h+i*l-n*o,this._w=a*c-i*o-n*l-s*h,this._onChangeCallback(),this}slerp(t,e){let i=t._x,n=t._y,s=t._z,a=t._w,o=this.dot(t);o<0&&(i=-i,n=-n,s=-s,a=-a,o=-o);let l=1-e;if(o<.9995){const h=Math.acos(o),c=Math.sin(h);l=Math.sin(l*h)/c,e=Math.sin(e*h)/c,this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,i){return this.copy(t).slerp(e,i)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),i=Math.random(),n=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(n*Math.sin(t),n*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class Z{static{Z.prototype.isVector3=!0}constructor(t=0,e=0,i=0){this.x=t,this.y=e,this.z=i}set(t,e,i){return i===void 0&&(i=this.z),this.x=t,this.y=e,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(Sd.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(Sd.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[3]*i+s[6]*n,this.y=s[1]*e+s[4]*i+s[7]*n,this.z=s[2]*e+s[5]*i+s[8]*n,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=t.elements,a=1/(s[3]*e+s[7]*i+s[11]*n+s[15]);return this.x=(s[0]*e+s[4]*i+s[8]*n+s[12])*a,this.y=(s[1]*e+s[5]*i+s[9]*n+s[13])*a,this.z=(s[2]*e+s[6]*i+s[10]*n+s[14])*a,this}applyQuaternion(t){const e=this.x,i=this.y,n=this.z,s=t.x,a=t.y,o=t.z,l=t.w,h=2*(a*n-o*i),c=2*(o*e-s*n),d=2*(s*i-a*e);return this.x=e+l*h+a*d-o*c,this.y=i+l*c+o*h-s*d,this.z=n+l*d+s*c-a*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[4]*i+s[8]*n,this.y=s[1]*e+s[5]*i+s[9]*n,this.z=s[2]*e+s[6]*i+s[10]*n,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Kt(this.x,t.x,e.x),this.y=Kt(this.y,t.y,e.y),this.z=Kt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Kt(this.x,t,e),this.y=Kt(this.y,t,e),this.z=Kt(this.z,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Kt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const i=t.x,n=t.y,s=t.z,a=e.x,o=e.y,l=e.z;return this.x=n*l-s*o,this.y=s*a-i*l,this.z=i*o-n*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const i=t.dot(this)/e;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return Il.copy(this).projectOnVector(t),this.sub(Il)}reflect(t){return this.sub(Il.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Kt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y,n=this.z-t.z;return e*e+i*i+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,i){const n=Math.sin(e)*t;return this.x=n*Math.sin(i),this.y=Math.cos(e)*t,this.z=n*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,i){return this.x=t*Math.sin(e),this.y=i,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),n=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=i,this.z=n,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,i=Math.sqrt(1-e*e);return this.x=i*Math.cos(t),this.y=e,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const Il=new Z,Sd=new Gn;class cn{static{cn.prototype.isMatrix3=!0}constructor(t,e,i,n,s,a,o,l,h){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h)}set(t,e,i,n,s,a,o,l,h){const c=this.elements;return c[0]=t,c[1]=n,c[2]=o,c[3]=e,c[4]=s,c[5]=l,c[6]=i,c[7]=a,c[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],this}extractBasis(t,e,i){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[3],l=i[6],h=i[1],c=i[4],d=i[7],u=i[2],f=i[5],p=i[8],x=n[0],m=n[3],g=n[6],v=n[1],S=n[4],_=n[7],E=n[2],b=n[5],A=n[8];return s[0]=a*x+o*v+l*E,s[3]=a*m+o*S+l*b,s[6]=a*g+o*_+l*A,s[1]=h*x+c*v+d*E,s[4]=h*m+c*S+d*b,s[7]=h*g+c*_+d*A,s[2]=u*x+f*v+p*E,s[5]=u*m+f*S+p*b,s[8]=u*g+f*_+p*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8];return e*a*c-e*o*h-i*s*c+i*o*l+n*s*h-n*a*l}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=c*a-o*h,u=o*l-c*s,f=h*s-a*l,p=e*d+i*u+n*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/p;return t[0]=d*x,t[1]=(n*h-c*i)*x,t[2]=(o*i-n*a)*x,t[3]=u*x,t[4]=(c*e-n*l)*x,t[5]=(n*s-o*e)*x,t[6]=f*x,t[7]=(i*l-h*e)*x,t[8]=(a*e-i*s)*x,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,i,n,s,a,o){const l=Math.cos(s),h=Math.sin(s);return this.set(i*l,i*h,-i*(l*a+h*o)+a+t,-n*h,n*l,-n*(-h*a+l*o)+o+e,0,0,1),this}scale(t,e){return ta("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(Dl.makeScale(t,e)),this}rotate(t){return ta("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(Dl.makeRotation(-t)),this}translate(t,e){return ta("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(Dl.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,i,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<9;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<9;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const Dl=new cn,wd=new cn().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Ed=new cn().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function hM(){const r={enabled:!0,workingColorSpace:gd,spaces:{},convert:function(n,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===Rl&&(n.r=an(n.r),n.g=an(n.g),n.b=an(n.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(n.applyMatrix3(this.spaces[s].toXYZ),n.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===Rl&&(n.r=lr(n.r),n.g=lr(n.g),n.b=lr(n.b))),n},workingToColorSpace:function(n,s){return this.convert(n,this.workingColorSpace,s)},colorSpaceToWorking:function(n,s){return this.convert(n,s,this.workingColorSpace)},getPrimaries:function(n){return this.spaces[n].primaries},getTransfer:function(n){return n===cp?xd:this.spaces[n].transfer},getToneMappingMode:function(n){return this.spaces[n].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(n,s=this.workingColorSpace){return n.fromArray(this.spaces[s].luminanceCoefficients)},define:function(n){Object.assign(this.spaces,n)},_getMatrix:function(n,s,a){return n.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(n){return this.spaces[n].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(n=this.workingColorSpace){return this.spaces[n].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(n,s){return ta("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),r.workingToColorSpace(n,s)},toWorkingColorSpace:function(n,s){return ta("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),r.colorSpaceToWorking(n,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],i=[.3127,.329];return r.define({[gd]:{primaries:t,whitePoint:i,transfer:xd,toXYZ:wd,fromXYZ:Ed,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:li},outputColorSpaceConfig:{drawingBufferColorSpace:li}},[li]:{primaries:t,whitePoint:i,transfer:Rl,toXYZ:wd,fromXYZ:Ed,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:li}}}),r}const Mi=hM();function an(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function lr(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}let Ls;class cM{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{Ls===void 0&&(Ls=vd("canvas")),Ls.width=t.width,Ls.height=t.height;const n=Ls.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),i=Ls}return i.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=vd("canvas");e.width=t.width,e.height=t.height;const i=e.getContext("2d");i.drawImage(t,0,0,t.width,t.height);const n=i.getImageData(0,0,t.width,t.height),s=n.data;for(let a=0;a<s.length;a++)s[a]=an(s[a]/255)*255;return i.putImageData(n,0,0),e}else if(t.data){const e=t.data.slice(0);for(let i=0;i<e.length;i++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[i]=Math.floor(an(e[i]/255)*255):e[i]=an(e[i]);return{data:e,width:t.width,height:t.height}}else return ke("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let uM=0;class dp{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:uM++}),this.uuid=Nn(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const i={uuid:this.uuid,url:""},n=this.data;if(n!==null){let s;if(Array.isArray(n)){s=[];for(let a=0,o=n.length;a<o;a++)n[a].isDataTexture?s.push(Ll(n[a].image)):s.push(Ll(n[a]))}else s=Ll(n);i.url=s}return e||(t.images[this.uuid]=i),i}}function Ll(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?cM.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(ke("Texture: Unable to serialize Texture."),{})}let dM=0;const Nl=new Z;class Vi extends br{constructor(t=Vi.DEFAULT_IMAGE,e=Vi.DEFAULT_MAPPING,i=ka,n=ka,s=tc,a=iM,o=sM,l=nM,h=Vi.DEFAULT_ANISOTROPY,c=cp){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:dM++}),this.uuid=Nn(),this.name="",this.source=new dp(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=i,this.wrapT=n,this.magFilter=s,this.minFilter=a,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new ne(0,0),this.repeat=new ne(1,1),this.center=new ne(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new cn,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=c,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Nl).x}get height(){return this.source.getSize(Nl).y}get depth(){return this.source.getSize(Nl).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const i=t[e];if(i===void 0){ke(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){ke(`Texture.setValues(): property '${e}' does not exist.`);continue}n&&i&&n.isVector2&&i.isVector2||n&&i&&n.isVector3&&i.isVector3||n&&i&&n.isMatrix3&&i.isMatrix3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),e||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==lp)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case dd:t.x=t.x-Math.floor(t.x);break;case ka:t.x=t.x<0?0:1;break;case fd:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case dd:t.y=t.y-Math.floor(t.y);break;case ka:t.y=t.y<0?0:1;break;case fd:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Vi.DEFAULT_IMAGE=null;Vi.DEFAULT_MAPPING=lp;Vi.DEFAULT_ANISOTROPY=1;class Hi{static{Hi.prototype.isVector4=!0}constructor(t=0,e=0,i=0,n=1){this.x=t,this.y=e,this.z=i,this.w=n}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,i,n){return this.x=t,this.y=e,this.z=i,this.w=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=this.w,a=t.elements;return this.x=a[0]*e+a[4]*i+a[8]*n+a[12]*s,this.y=a[1]*e+a[5]*i+a[9]*n+a[13]*s,this.z=a[2]*e+a[6]*i+a[10]*n+a[14]*s,this.w=a[3]*e+a[7]*i+a[11]*n+a[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,i,n,s;const l=t.elements,h=l[0],c=l[4],d=l[8],u=l[1],f=l[5],p=l[9],x=l[2],m=l[6],g=l[10];if(Math.abs(c-u)<.01&&Math.abs(d-x)<.01&&Math.abs(p-m)<.01){if(Math.abs(c+u)<.1&&Math.abs(d+x)<.1&&Math.abs(p+m)<.1&&Math.abs(h+f+g-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const S=(h+1)/2,_=(f+1)/2,E=(g+1)/2,b=(c+u)/4,A=(d+x)/4,y=(p+m)/4;return S>_&&S>E?S<.01?(i=0,n=.707106781,s=.707106781):(i=Math.sqrt(S),n=b/i,s=A/i):_>E?_<.01?(i=.707106781,n=0,s=.707106781):(n=Math.sqrt(_),i=b/n,s=y/n):E<.01?(i=.707106781,n=.707106781,s=0):(s=Math.sqrt(E),i=A/s,n=y/s),this.set(i,n,s,e),this}let v=Math.sqrt((m-p)*(m-p)+(d-x)*(d-x)+(u-c)*(u-c));return Math.abs(v)<.001&&(v=1),this.x=(m-p)/v,this.y=(d-x)/v,this.z=(u-c)/v,this.w=Math.acos((h+f+g-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Kt(this.x,t.x,e.x),this.y=Kt(this.y,t.y,e.y),this.z=Kt(this.z,t.z,e.z),this.w=Kt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Kt(this.x,t,e),this.y=Kt(this.y,t,e),this.z=Kt(this.z,t,e),this.w=Kt(this.w,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Kt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this.w=t.w+(e.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class fM extends br{constructor(t=1,e=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:tc,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},i),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=i.depth,this.scissor=new Hi(0,0,t,e),this.scissorTest=!1,this.viewport=new Hi(0,0,t,e),this.textures=[];const n={width:t,height:e,depth:i.depth},s=new Vi(n),a=i.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview,this.useArrayDepthTexture=i.useArrayDepthTexture}_setTextureOptions(t={}){const e={minFilter:tc,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,i=1){if(this.width!==t||this.height!==e||this.depth!==i){this.width=t,this.height=e,this.depth=i;for(let n=0,s=this.textures.length;n<s;n++)this.textures[n].image.width=t,this.textures[n].image.height=e,this.textures[n].image.depth=i,this.textures[n].isData3DTexture!==!0&&(this.textures[n].isArrayTexture=this.textures[n].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,i=t.textures.length;e<i;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const n=Object.assign({},t.textures[e].image);this.textures[e].source=new dp(n)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Td extends fM{constructor(t=1,e=1,i={}){super(t,e,i),this.isWebGLRenderTarget=!0}}class Ie{static{Ie.prototype.isMatrix4=!0}constructor(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,m)}set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,m){const g=this.elements;return g[0]=t,g[4]=e,g[8]=i,g[12]=n,g[1]=s,g[5]=a,g[9]=o,g[13]=l,g[2]=h,g[6]=c,g[10]=d,g[14]=u,g[3]=f,g[7]=p,g[11]=x,g[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Ie().fromArray(this.elements)}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],e[9]=i[9],e[10]=i[10],e[11]=i[11],e[12]=i[12],e[13]=i[13],e[14]=i[14],e[15]=i[15],this}copyPosition(t){const e=this.elements,i=t.elements;return e[12]=i[12],e[13]=i[13],e[14]=i[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,i){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,e,i){return this.set(t.x,e.x,i.x,0,t.y,e.y,i.y,0,t.z,e.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,i=t.elements,n=1/Ns.setFromMatrixColumn(t,0).length(),s=1/Ns.setFromMatrixColumn(t,1).length(),a=1/Ns.setFromMatrixColumn(t,2).length();return e[0]=i[0]*n,e[1]=i[1]*n,e[2]=i[2]*n,e[3]=0,e[4]=i[4]*s,e[5]=i[5]*s,e[6]=i[6]*s,e[7]=0,e[8]=i[8]*a,e[9]=i[9]*a,e[10]=i[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,i=t.x,n=t.y,s=t.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(n),h=Math.sin(n),c=Math.cos(s),d=Math.sin(s);if(t.order==="XYZ"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=-l*d,e[8]=h,e[1]=f+p*h,e[5]=u-x*h,e[9]=-o*l,e[2]=x-u*h,e[6]=p+f*h,e[10]=a*l}else if(t.order==="YXZ"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u+x*o,e[4]=p*o-f,e[8]=a*h,e[1]=a*d,e[5]=a*c,e[9]=-o,e[2]=f*o-p,e[6]=x+u*o,e[10]=a*l}else if(t.order==="ZXY"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u-x*o,e[4]=-a*d,e[8]=p+f*o,e[1]=f+p*o,e[5]=a*c,e[9]=x-u*o,e[2]=-a*h,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=p*h-f,e[8]=u*h+x,e[1]=l*d,e[5]=x*h+u,e[9]=f*h-p,e[2]=-h,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=x-u*d,e[8]=p*d+f,e[1]=d,e[5]=a*c,e[9]=-o*c,e[2]=-h*c,e[6]=f*d+p,e[10]=u-x*d}else if(t.order==="XZY"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=-d,e[8]=h*c,e[1]=u*d+x,e[5]=a*c,e[9]=f*d-p,e[2]=p*d-f,e[6]=o*c,e[10]=x*d+u}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(pM,t,mM)}lookAt(t,e,i){const n=this.elements;return ri.subVectors(t,e),ri.lengthSq()===0&&(ri.z=1),ri.normalize(),vn.crossVectors(i,ri),vn.lengthSq()===0&&(Math.abs(i.z)===1?ri.x+=1e-4:ri.z+=1e-4,ri.normalize(),vn.crossVectors(i,ri)),vn.normalize(),Ba.crossVectors(ri,vn),n[0]=vn.x,n[4]=Ba.x,n[8]=ri.x,n[1]=vn.y,n[5]=Ba.y,n[9]=ri.y,n[2]=vn.z,n[6]=Ba.z,n[10]=ri.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[4],l=i[8],h=i[12],c=i[1],d=i[5],u=i[9],f=i[13],p=i[2],x=i[6],m=i[10],g=i[14],v=i[3],S=i[7],_=i[11],E=i[15],b=n[0],A=n[4],y=n[8],w=n[12],C=n[1],R=n[5],I=n[9],z=n[13],G=n[2],L=n[6],N=n[10],D=n[14],$=n[3],Q=n[7],st=n[11],rt=n[15];return s[0]=a*b+o*C+l*G+h*$,s[4]=a*A+o*R+l*L+h*Q,s[8]=a*y+o*I+l*N+h*st,s[12]=a*w+o*z+l*D+h*rt,s[1]=c*b+d*C+u*G+f*$,s[5]=c*A+d*R+u*L+f*Q,s[9]=c*y+d*I+u*N+f*st,s[13]=c*w+d*z+u*D+f*rt,s[2]=p*b+x*C+m*G+g*$,s[6]=p*A+x*R+m*L+g*Q,s[10]=p*y+x*I+m*N+g*st,s[14]=p*w+x*z+m*D+g*rt,s[3]=v*b+S*C+_*G+E*$,s[7]=v*A+S*R+_*L+E*Q,s[11]=v*y+S*I+_*N+E*st,s[15]=v*w+S*z+_*D+E*rt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[12],a=t[1],o=t[5],l=t[9],h=t[13],c=t[2],d=t[6],u=t[10],f=t[14],p=t[3],x=t[7],m=t[11],g=t[15],v=l*f-h*u,S=o*f-h*d,_=o*u-l*d,E=a*f-h*c,b=a*u-l*c,A=a*d-o*c;return e*(x*v-m*S+g*_)-i*(p*v-m*E+g*b)+n*(p*S-x*E+g*A)-s*(p*_-x*b+m*A)}determinantAffine(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[1],a=t[5],o=t[9],l=t[2],h=t[6],c=t[10];return e*(a*c-o*h)-i*(s*c-o*l)+n*(s*h-a*l)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,i){const n=this.elements;return t.isVector3?(n[12]=t.x,n[13]=t.y,n[14]=t.z):(n[12]=t,n[13]=e,n[14]=i),this}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=t[9],u=t[10],f=t[11],p=t[12],x=t[13],m=t[14],g=t[15],v=e*o-i*a,S=e*l-n*a,_=e*h-s*a,E=i*l-n*o,b=i*h-s*o,A=n*h-s*l,y=c*x-d*p,w=c*m-u*p,C=c*g-f*p,R=d*m-u*x,I=d*g-f*x,z=u*g-f*m,G=v*z-S*I+_*R+E*C-b*w+A*y;if(G===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const L=1/G;return t[0]=(o*z-l*I+h*R)*L,t[1]=(n*I-i*z-s*R)*L,t[2]=(x*A-m*b+g*E)*L,t[3]=(u*b-d*A-f*E)*L,t[4]=(l*C-a*z-h*w)*L,t[5]=(e*z-n*C+s*w)*L,t[6]=(m*_-p*A-g*S)*L,t[7]=(c*A-u*_+f*S)*L,t[8]=(a*I-o*C+h*y)*L,t[9]=(i*C-e*I-s*y)*L,t[10]=(p*b-x*_+g*v)*L,t[11]=(d*_-c*b-f*v)*L,t[12]=(o*w-a*R-l*y)*L,t[13]=(e*R-i*w+n*y)*L,t[14]=(x*S-p*E-m*v)*L,t[15]=(c*E-d*S+u*v)*L,this}scale(t){const e=this.elements,i=t.x,n=t.y,s=t.z;return e[0]*=i,e[4]*=n,e[8]*=s,e[1]*=i,e[5]*=n,e[9]*=s,e[2]*=i,e[6]*=n,e[10]*=s,e[3]*=i,e[7]*=n,e[11]*=s,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],n=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,i,n))}makeTranslation(t,e,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,i,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,e,-i,0,0,i,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,0,i,0,0,1,0,0,-i,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,0,i,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const i=Math.cos(e),n=Math.sin(e),s=1-i,a=t.x,o=t.y,l=t.z,h=s*a,c=s*o;return this.set(h*a+i,h*o-n*l,h*l+n*o,0,h*o+n*l,c*o+i,c*l-n*a,0,h*l-n*o,c*l+n*a,s*l*l+i,0,0,0,0,1),this}makeScale(t,e,i){return this.set(t,0,0,0,0,e,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,e,i,n,s,a){return this.set(1,i,s,0,t,1,a,0,e,n,1,0,0,0,0,1),this}compose(t,e,i){const n=this.elements,s=e._x,a=e._y,o=e._z,l=e._w,h=s+s,c=a+a,d=o+o,u=s*h,f=s*c,p=s*d,x=a*c,m=a*d,g=o*d,v=l*h,S=l*c,_=l*d,E=i.x,b=i.y,A=i.z;return n[0]=(1-(x+g))*E,n[1]=(f+_)*E,n[2]=(p-S)*E,n[3]=0,n[4]=(f-_)*b,n[5]=(1-(u+g))*b,n[6]=(m+v)*b,n[7]=0,n[8]=(p+S)*A,n[9]=(m-v)*A,n[10]=(1-(u+x))*A,n[11]=0,n[12]=t.x,n[13]=t.y,n[14]=t.z,n[15]=1,this}decompose(t,e,i){const n=this.elements;t.x=n[12],t.y=n[13],t.z=n[14];const s=this.determinantAffine();if(s===0)return i.set(1,1,1),e.identity(),this;let a=Ns.set(n[0],n[1],n[2]).length();const o=Ns.set(n[4],n[5],n[6]).length(),l=Ns.set(n[8],n[9],n[10]).length();s<0&&(a=-a),bi.copy(this);const h=1/a,c=1/o,d=1/l;return bi.elements[0]*=h,bi.elements[1]*=h,bi.elements[2]*=h,bi.elements[4]*=c,bi.elements[5]*=c,bi.elements[6]*=c,bi.elements[8]*=d,bi.elements[9]*=d,bi.elements[10]*=d,e.setFromRotationMatrix(bi),i.x=a,i.y=o,i.z=l,this}makePerspective(t,e,i,n,s,a,o=Zr,l=!1){const h=this.elements,c=2*s/(e-t),d=2*s/(i-n),u=(e+t)/(e-t),f=(i+n)/(i-n);let p,x;if(l)p=s/(a-s),x=a*s/(a-s);else if(o===Zr)p=-(a+s)/(a-s),x=-2*a*s/(a-s);else if(o===_d)p=-a/(a-s),x=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=u,h[12]=0,h[1]=0,h[5]=d,h[9]=f,h[13]=0,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,e,i,n,s,a,o=Zr,l=!1){const h=this.elements,c=2/(e-t),d=2/(i-n),u=-(e+t)/(e-t),f=-(i+n)/(i-n);let p,x;if(l)p=1/(a-s),x=a/(a-s);else if(o===Zr)p=-2/(a-s),x=-(a+s)/(a-s);else if(o===_d)p=-1/(a-s),x=-s/(a-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=0,h[12]=u,h[1]=0,h[5]=d,h[9]=0,h[13]=f,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<16;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<16;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t[e+9]=i[9],t[e+10]=i[10],t[e+11]=i[11],t[e+12]=i[12],t[e+13]=i[13],t[e+14]=i[14],t[e+15]=i[15],t}}const Ns=new Z,bi=new Ie,pM=new Z(0,0,0),mM=new Z(1,1,1),vn=new Z,Ba=new Z,ri=new Z,Ad=new Ie,Cd=new Gn;class as{constructor(t=0,e=0,i=0,n=as.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=i,this._order=n}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,i,n=this._order){return this._x=t,this._y=e,this._z=i,this._order=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,i=!0){const n=t.elements,s=n[0],a=n[4],o=n[8],l=n[1],h=n[5],c=n[9],d=n[2],u=n[6],f=n[10];switch(e){case"XYZ":this._y=Math.asin(Kt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-c,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(u,h),this._z=0);break;case"YXZ":this._x=Math.asin(-Kt(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Kt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-a,h)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Kt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(u,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,h));break;case"YZX":this._z=Math.asin(Kt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-c,h),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Kt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(u,h),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-c,f),this._y=0);break;default:ke("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,i){return Ad.makeRotationFromQuaternion(t),this.setFromRotationMatrix(Ad,e,i)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return Cd.setFromEuler(this),this.setFromQuaternion(Cd,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}as.DEFAULT_ORDER="XYZ";class gM{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let xM=0;const Rd=new Z,Fs=new Gn,Zi=new Ie,Va=new Z,Nr=new Z,yM=new Z,_M=new Gn,Pd=new Z(1,0,0),Id=new Z(0,1,0),Dd=new Z(0,0,1),Ld={type:"added"},vM={type:"removed"},Us={type:"childadded",child:null},Fl={type:"childremoved",child:null};class Je extends br{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:xM++}),this.uuid=Nn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Je.DEFAULT_UP.clone();const t=new Z,e=new as,i=new Gn,n=new Z(1,1,1);function s(){i.setFromEuler(e,!1)}function a(){e.setFromQuaternion(i,void 0,!1)}e._onChange(s),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:n},modelViewMatrix:{value:new Ie},normalMatrix:{value:new cn}}),this.matrix=new Ie,this.matrixWorld=new Ie,this.matrixAutoUpdate=Je.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Je.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new gM,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return Fs.setFromAxisAngle(t,e),this.quaternion.multiply(Fs),this}rotateOnWorldAxis(t,e){return Fs.setFromAxisAngle(t,e),this.quaternion.premultiply(Fs),this}rotateX(t){return this.rotateOnAxis(Pd,t)}rotateY(t){return this.rotateOnAxis(Id,t)}rotateZ(t){return this.rotateOnAxis(Dd,t)}translateOnAxis(t,e){return Rd.copy(t).applyQuaternion(this.quaternion),this.position.add(Rd.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(Pd,t)}translateY(t){return this.translateOnAxis(Id,t)}translateZ(t){return this.translateOnAxis(Dd,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Zi.copy(this.matrixWorld).invert())}lookAt(t,e,i){t.isVector3?Va.copy(t):Va.set(t,e,i);const n=this.parent;this.updateWorldMatrix(!0,!1),Nr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Zi.lookAt(Nr,Va,this.up):Zi.lookAt(Va,Nr,this.up),this.quaternion.setFromRotationMatrix(Zi),n&&(Zi.extractRotation(n.matrixWorld),Fs.setFromRotationMatrix(Zi),this.quaternion.premultiply(Fs.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(In("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Ld),Us.child=t,this.dispatchEvent(Us),Us.child=null):In("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(vM),Fl.child=t,this.dispatchEvent(Fl),Fl.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Zi.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Zi.multiply(t.parent.matrixWorld)),t.applyMatrix4(Zi),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Ld),Us.child=t,this.dispatchEvent(Us),Us.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let i=0,n=this.children.length;i<n;i++){const a=this.children[i].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,i=[]){this[t]===e&&i.push(this);const n=this.children;for(let s=0,a=n.length;s<a;s++)n[s].getObjectsByProperty(t,e,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Nr,t,yM),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Nr,_M,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,i=t.y,n=t.z,s=this.matrix.elements;s[12]+=e-s[0]*e-s[4]*i-s[8]*n,s[13]+=i-s[1]*e-s[5]*i-s[9]*n,s[14]+=n-s[2]*e-s[6]*i-s[10]*n}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].updateMatrixWorld(t)}updateWorldMatrix(t,e,i=!1){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),e===!0){const s=this.children;for(let a=0,o=s.length;a<o;a++)s[a].updateWorldMatrix(!1,!0,i)}}toJSON(t){const e=t===void 0||typeof t=="string",i={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const n={};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.castShadow===!0&&(n.castShadow=!0),this.receiveShadow===!0&&(n.receiveShadow=!0),this.visible===!1&&(n.visible=!1),this.frustumCulled===!1&&(n.frustumCulled=!1),this.renderOrder!==0&&(n.renderOrder=this.renderOrder),this.static!==!1&&(n.static=this.static),Object.keys(this.userData).length>0&&(n.userData=this.userData),n.layers=this.layers.mask,n.matrix=this.matrix.toArray(),n.up=this.up.toArray(),this.pivot!==null&&(n.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(n.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(n.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(n.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(n.type="InstancedMesh",n.count=this.count,n.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(n.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(n.type="BatchedMesh",n.perObjectFrustumCulled=this.perObjectFrustumCulled,n.sortObjects=this.sortObjects,n.drawRanges=this._drawRanges,n.reservedRanges=this._reservedRanges,n.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),n.instanceInfo=this._instanceInfo.map(o=>({...o})),n.availableInstanceIds=this._availableInstanceIds.slice(),n.availableGeometryIds=this._availableGeometryIds.slice(),n.nextIndexStart=this._nextIndexStart,n.nextVertexStart=this._nextVertexStart,n.geometryCount=this._geometryCount,n.maxInstanceCount=this._maxInstanceCount,n.maxVertexCount=this._maxVertexCount,n.maxIndexCount=this._maxIndexCount,n.geometryInitialized=this._geometryInitialized,n.matricesTexture=this._matricesTexture.toJSON(t),n.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(n.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(n.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(n.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?n.background=this.background.toJSON():this.background.isTexture&&(n.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(n.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){n.geometry=s(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let h=0,c=l.length;h<c;h++){const d=l[h];s(t.shapes,d)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(n.bindMode=this.bindMode,n.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),n.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(s(t.materials,this.material[l]));n.material=o}else n.material=s(t.materials,this.material);if(this.children.length>0){n.children=[];for(let o=0;o<this.children.length;o++)n.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){n.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];n.animations.push(s(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),h=a(t.textures),c=a(t.images),d=a(t.shapes),u=a(t.skeletons),f=a(t.animations),p=a(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),c.length>0&&(i.images=c),d.length>0&&(i.shapes=d),u.length>0&&(i.skeletons=u),f.length>0&&(i.animations=f),p.length>0&&(i.nodes=p)}return i.object=n,i;function a(o){const l=[];for(const h in o){const c=o[h];delete c.metadata,l.push(c)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let i=0;i<t.children.length;i++){const n=t.children[i];this.add(n.clone())}return this}}Je.DEFAULT_UP=new Z(0,1,0);Je.DEFAULT_MATRIX_AUTO_UPDATE=!0;Je.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;class Ee extends Je{constructor(){super(),this.isGroup=!0,this.type="Group"}}const fp={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Mn={h:0,s:0,l:0},Ga={h:0,s:0,l:0};function Ul(r,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?r+(t-r)*6*e:e<1/2?t:e<2/3?r+(t-r)*6*(2/3-e):r}class ti{constructor(t,e,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,i)}set(t,e,i){if(e===void 0&&i===void 0){const n=t;n&&n.isColor?this.copy(n):typeof n=="number"?this.setHex(n):typeof n=="string"&&this.setStyle(n)}else this.setRGB(t,e,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=li){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,Mi.colorSpaceToWorking(this,e),this}setRGB(t,e,i,n=Mi.workingColorSpace){return this.r=t,this.g=e,this.b=i,Mi.colorSpaceToWorking(this,n),this}setHSL(t,e,i,n=Mi.workingColorSpace){if(t=lM(t,1),e=Kt(e,0,1),i=Kt(i,0,1),e===0)this.r=this.g=this.b=i;else{const s=i<=.5?i*(1+e):i+e-i*e,a=2*i-s;this.r=Ul(a,s,t+1/3),this.g=Ul(a,s,t),this.b=Ul(a,s,t-1/3)}return Mi.colorSpaceToWorking(this,n),this}setStyle(t,e=li){function i(s){s!==void 0&&parseFloat(s)<1&&ke("Color: Alpha component of "+t+" will be ignored.")}let n;if(n=/^(\w+)\(([^\)]*)\)/.exec(t)){let s;const a=n[1],o=n[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:ke("Color: Unknown color model "+t)}}else if(n=/^\#([A-Fa-f\d]+)$/.exec(t)){const s=n[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(s,16),e);ke("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=li){const i=fp[t.toLowerCase()];return i!==void 0?this.setHex(i,e):ke("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=an(t.r),this.g=an(t.g),this.b=an(t.b),this}copyLinearToSRGB(t){return this.r=lr(t.r),this.g=lr(t.g),this.b=lr(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=li){return Mi.workingToColorSpace(Xe.copy(this),t),Math.round(Kt(Xe.r*255,0,255))*65536+Math.round(Kt(Xe.g*255,0,255))*256+Math.round(Kt(Xe.b*255,0,255))}getHexString(t=li){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=Mi.workingColorSpace){Mi.workingToColorSpace(Xe.copy(this),e);const i=Xe.r,n=Xe.g,s=Xe.b,a=Math.max(i,n,s),o=Math.min(i,n,s);let l,h;const c=(o+a)/2;if(o===a)l=0,h=0;else{const d=a-o;switch(h=c<=.5?d/(a+o):d/(2-a-o),a){case i:l=(n-s)/d+(n<s?6:0);break;case n:l=(s-i)/d+2;break;case s:l=(i-n)/d+4;break}l/=6}return t.h=l,t.s=h,t.l=c,t}getRGB(t,e=Mi.workingColorSpace){return Mi.workingToColorSpace(Xe.copy(this),e),t.r=Xe.r,t.g=Xe.g,t.b=Xe.b,t}getStyle(t=li){Mi.workingToColorSpace(Xe.copy(this),t);const e=Xe.r,i=Xe.g,n=Xe.b;return t!==li?`color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${n.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(i*255)},${Math.round(n*255)})`}offsetHSL(t,e,i){return this.getHSL(Mn),this.setHSL(Mn.h+t,Mn.s+e,Mn.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,i){return this.r=t.r+(e.r-t.r)*i,this.g=t.g+(e.g-t.g)*i,this.b=t.b+(e.b-t.b)*i,this}lerpHSL(t,e){this.getHSL(Mn),t.getHSL(Ga);const i=Pl(Mn.h,Ga.h,e),n=Pl(Mn.s,Ga.s,e),s=Pl(Mn.l,Ga.l,e);return this.setHSL(i,n,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,i=this.g,n=this.b,s=t.elements;return this.r=s[0]*e+s[3]*i+s[6]*n,this.g=s[1]*e+s[4]*i+s[7]*n,this.b=s[2]*e+s[5]*i+s[8]*n,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Xe=new ti;ti.NAMES=fp;class MM extends Je{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new as,this.environmentIntensity=1,this.environmentRotation=new as,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}const Si=new Z,Ki=new Z,zl=new Z,Ji=new Z,zs=new Z,Os=new Z,Nd=new Z,Ol=new Z,kl=new Z,Bl=new Z,Vl=new Hi,Gl=new Hi,Hl=new Hi;class mi{constructor(t=new Z,e=new Z,i=new Z){this.a=t,this.b=e,this.c=i}static getNormal(t,e,i,n){n.subVectors(i,e),Si.subVectors(t,e),n.cross(Si);const s=n.lengthSq();return s>0?n.multiplyScalar(1/Math.sqrt(s)):n.set(0,0,0)}static getBarycoord(t,e,i,n,s){Si.subVectors(n,e),Ki.subVectors(i,e),zl.subVectors(t,e);const a=Si.dot(Si),o=Si.dot(Ki),l=Si.dot(zl),h=Ki.dot(Ki),c=Ki.dot(zl),d=a*h-o*o;if(d===0)return s.set(0,0,0),null;const u=1/d,f=(h*l-o*c)*u,p=(a*c-o*l)*u;return s.set(1-f-p,p,f)}static containsPoint(t,e,i,n){return this.getBarycoord(t,e,i,n,Ji)===null?!1:Ji.x>=0&&Ji.y>=0&&Ji.x+Ji.y<=1}static getInterpolation(t,e,i,n,s,a,o,l){return this.getBarycoord(t,e,i,n,Ji)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Ji.x),l.addScaledVector(a,Ji.y),l.addScaledVector(o,Ji.z),l)}static getInterpolatedAttribute(t,e,i,n,s,a){return Vl.setScalar(0),Gl.setScalar(0),Hl.setScalar(0),Vl.fromBufferAttribute(t,e),Gl.fromBufferAttribute(t,i),Hl.fromBufferAttribute(t,n),a.setScalar(0),a.addScaledVector(Vl,s.x),a.addScaledVector(Gl,s.y),a.addScaledVector(Hl,s.z),a}static isFrontFacing(t,e,i,n){return Si.subVectors(i,e),Ki.subVectors(t,e),Si.cross(Ki).dot(n)<0}set(t,e,i){return this.a.copy(t),this.b.copy(e),this.c.copy(i),this}setFromPointsAndIndices(t,e,i,n){return this.a.copy(t[e]),this.b.copy(t[i]),this.c.copy(t[n]),this}setFromAttributeAndIndices(t,e,i,n){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Si.subVectors(this.c,this.b),Ki.subVectors(this.a,this.b),Si.cross(Ki).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return mi.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return mi.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,i,n,s){return mi.getInterpolation(t,this.a,this.b,this.c,e,i,n,s)}containsPoint(t){return mi.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return mi.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const i=this.a,n=this.b,s=this.c;let a,o;zs.subVectors(n,i),Os.subVectors(s,i),Ol.subVectors(t,i);const l=zs.dot(Ol),h=Os.dot(Ol);if(l<=0&&h<=0)return e.copy(i);kl.subVectors(t,n);const c=zs.dot(kl),d=Os.dot(kl);if(c>=0&&d<=c)return e.copy(n);const u=l*d-c*h;if(u<=0&&l>=0&&c<=0)return a=l/(l-c),e.copy(i).addScaledVector(zs,a);Bl.subVectors(t,s);const f=zs.dot(Bl),p=Os.dot(Bl);if(p>=0&&f<=p)return e.copy(s);const x=f*h-l*p;if(x<=0&&h>=0&&p<=0)return o=h/(h-p),e.copy(i).addScaledVector(Os,o);const m=c*p-f*d;if(m<=0&&d-c>=0&&f-p>=0)return Nd.subVectors(s,n),o=(d-c)/(d-c+(f-p)),e.copy(n).addScaledVector(Nd,o);const g=1/(m+x+u);return a=x*g,o=u*g,e.copy(i).addScaledVector(zs,a).addScaledVector(Os,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}class cs{constructor(t=new Z(1/0,1/0,1/0),e=new Z(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e+=3)this.expandByPoint(wi.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,i=t.count;e<i;e++)this.expandByPoint(wi.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const i=wi.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const i=t.geometry;if(i!==void 0){const s=i.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,wi):wi.fromBufferAttribute(s,a),wi.applyMatrix4(t.matrixWorld),this.expandByPoint(wi);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),Ha.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Ha.copy(i.boundingBox)),Ha.applyMatrix4(t.matrixWorld),this.union(Ha)}const n=t.children;for(let s=0,a=n.length;s<a;s++)this.expandByObject(n[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,wi),wi.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,i;return t.normal.x>0?(e=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),e<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Fr),Wa.subVectors(this.max,Fr),ks.subVectors(t.a,Fr),Bs.subVectors(t.b,Fr),Vs.subVectors(t.c,Fr),bn.subVectors(Bs,ks),Sn.subVectors(Vs,Bs),Zn.subVectors(ks,Vs);let e=[0,-bn.z,bn.y,0,-Sn.z,Sn.y,0,-Zn.z,Zn.y,bn.z,0,-bn.x,Sn.z,0,-Sn.x,Zn.z,0,-Zn.x,-bn.y,bn.x,0,-Sn.y,Sn.x,0,-Zn.y,Zn.x,0];return!Wl(e,ks,Bs,Vs,Wa)||(e=[1,0,0,0,1,0,0,0,1],!Wl(e,ks,Bs,Vs,Wa))?!1:(Xa.crossVectors(bn,Sn),e=[Xa.x,Xa.y,Xa.z],Wl(e,ks,Bs,Vs,Wa))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,wi).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(wi).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(Qi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),Qi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),Qi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),Qi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),Qi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),Qi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),Qi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),Qi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(Qi),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}}const Qi=[new Z,new Z,new Z,new Z,new Z,new Z,new Z,new Z],wi=new Z,Ha=new cs,ks=new Z,Bs=new Z,Vs=new Z,bn=new Z,Sn=new Z,Zn=new Z,Fr=new Z,Wa=new Z,Xa=new Z,Kn=new Z;function Wl(r,t,e,i,n){for(let s=0,a=r.length-3;s<=a;s+=3){Kn.fromArray(r,s);const o=n.x*Math.abs(Kn.x)+n.y*Math.abs(Kn.y)+n.z*Math.abs(Kn.z),l=t.dot(Kn),h=e.dot(Kn),c=i.dot(Kn);if(Math.max(-Math.max(l,h,c),Math.min(l,h,c))>o)return!1}return!0}const Re=new Z,qa=new ne;let bM=0;class ei extends br{constructor(t,e,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:bM++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=i,this.usage=ec,this.updateRanges=[],this.gpuType=hp,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,i){t*=this.itemSize,i*=e.itemSize;for(let n=0,s=this.itemSize;n<s;n++)this.array[t+n]=e.array[i+n];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,i=this.count;e<i;e++)qa.fromBufferAttribute(this,e),qa.applyMatrix3(t),this.setXY(e,qa.x,qa.y);else if(this.itemSize===3)for(let e=0,i=this.count;e<i;e++)Re.fromBufferAttribute(this,e),Re.applyMatrix3(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}applyMatrix4(t){for(let e=0,i=this.count;e<i;e++)Re.fromBufferAttribute(this,e),Re.applyMatrix4(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)Re.fromBufferAttribute(this,e),Re.applyNormalMatrix(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)Re.fromBufferAttribute(this,e),Re.transformDirection(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let i=this.array[t*this.itemSize+e];return this.normalized&&(i=Oi(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=ae(i,this.array)),this.array[t*this.itemSize+e]=i,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Oi(e,this.array)),e}setX(t,e){return this.normalized&&(e=ae(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Oi(e,this.array)),e}setY(t,e){return this.normalized&&(e=ae(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Oi(e,this.array)),e}setZ(t,e){return this.normalized&&(e=ae(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Oi(e,this.array)),e}setW(t,e){return this.normalized&&(e=ae(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,i){return t*=this.itemSize,this.normalized&&(e=ae(e,this.array),i=ae(i,this.array)),this.array[t+0]=e,this.array[t+1]=i,this}setXYZ(t,e,i,n){return t*=this.itemSize,this.normalized&&(e=ae(e,this.array),i=ae(i,this.array),n=ae(n,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this}setXYZW(t,e,i,n,s){return t*=this.itemSize,this.normalized&&(e=ae(e,this.array),i=ae(i,this.array),n=ae(n,this.array),s=ae(s,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==ec&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}}class SM extends ei{constructor(t,e,i){super(new Uint16Array(t),e,i)}}class wM extends ei{constructor(t,e,i){super(new Uint32Array(t),e,i)}}class ge extends ei{constructor(t,e,i){super(new Float32Array(t),e,i)}}const EM=new cs,Ur=new Z,Xl=new Z;class Sr{constructor(t=new Z,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const i=this.center;e!==void 0?i.copy(e):EM.setFromPoints(t).getCenter(i);let n=0;for(let s=0,a=t.length;s<a;s++)n=Math.max(n,i.distanceToSquared(t[s]));return this.radius=Math.sqrt(n),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const i=this.center.distanceToSquared(t);return e.copy(t),i>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Ur.subVectors(t,this.center);const e=Ur.lengthSq();if(e>this.radius*this.radius){const i=Math.sqrt(e),n=(i-this.radius)*.5;this.center.addScaledVector(Ur,n/i),this.radius+=n}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(Xl.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Ur.copy(t.center).add(Xl)),this.expandByPoint(Ur.copy(t.center).sub(Xl))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}}let TM=0;const pi=new Ie,ql=new Je,Gs=new Z,ai=new cs,zr=new cs,Ue=new Z;class ze extends br{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:TM++}),this.uuid=Nn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(oM(t)?wM:SM)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,i=0){this.groups.push({start:t,count:e,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const s=new cn().getNormalMatrix(t);i.applyNormalMatrix(s),i.needsUpdate=!0}const n=this.attributes.tangent;return n!==void 0&&(n.transformDirection(t),n.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return pi.makeRotationFromQuaternion(t),this.applyMatrix4(pi),this}rotateX(t){return pi.makeRotationX(t),this.applyMatrix4(pi),this}rotateY(t){return pi.makeRotationY(t),this.applyMatrix4(pi),this}rotateZ(t){return pi.makeRotationZ(t),this.applyMatrix4(pi),this}translate(t,e,i){return pi.makeTranslation(t,e,i),this.applyMatrix4(pi),this}scale(t,e,i){return pi.makeScale(t,e,i),this.applyMatrix4(pi),this}lookAt(t){return ql.lookAt(t),ql.updateMatrix(),this.applyMatrix4(ql.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Gs).negate(),this.translate(Gs.x,Gs.y,Gs.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const i=[];for(let n=0,s=t.length;n<s;n++){const a=t[n];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new ge(i,3))}else{const i=Math.min(t.length,e.count);for(let n=0;n<i;n++){const s=t[n];e.setXYZ(n,s.x,s.y,s.z||0)}t.length>e.count&&ke("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new cs);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){In("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new Z(-1/0,-1/0,-1/0),new Z(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let i=0,n=e.length;i<n;i++){const s=e[i];ai.setFromBufferAttribute(s),this.morphTargetsRelative?(Ue.addVectors(this.boundingBox.min,ai.min),this.boundingBox.expandByPoint(Ue),Ue.addVectors(this.boundingBox.max,ai.max),this.boundingBox.expandByPoint(Ue)):(this.boundingBox.expandByPoint(ai.min),this.boundingBox.expandByPoint(ai.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&In('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Sr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){In("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new Z,1/0);return}if(t){const i=this.boundingSphere.center;if(ai.setFromBufferAttribute(t),e)for(let s=0,a=e.length;s<a;s++){const o=e[s];zr.setFromBufferAttribute(o),this.morphTargetsRelative?(Ue.addVectors(ai.min,zr.min),ai.expandByPoint(Ue),Ue.addVectors(ai.max,zr.max),ai.expandByPoint(Ue)):(ai.expandByPoint(zr.min),ai.expandByPoint(zr.max))}ai.getCenter(i);let n=0;for(let s=0,a=t.count;s<a;s++)Ue.fromBufferAttribute(t,s),n=Math.max(n,i.distanceToSquared(Ue));if(e)for(let s=0,a=e.length;s<a;s++){const o=e[s],l=this.morphTargetsRelative;for(let h=0,c=o.count;h<c;h++)Ue.fromBufferAttribute(o,h),l&&(Gs.fromBufferAttribute(t,h),Ue.add(Gs)),n=Math.max(n,i.distanceToSquared(Ue))}this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&In('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){In("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=e.position,n=e.normal,s=e.uv;let a=this.getAttribute("tangent");(a===void 0||a.count!==i.count)&&(a=new ei(new Float32Array(4*i.count),4),this.setAttribute("tangent",a));const o=[],l=[];for(let y=0;y<i.count;y++)o[y]=new Z,l[y]=new Z;const h=new Z,c=new Z,d=new Z,u=new ne,f=new ne,p=new ne,x=new Z,m=new Z;function g(y,w,C){h.fromBufferAttribute(i,y),c.fromBufferAttribute(i,w),d.fromBufferAttribute(i,C),u.fromBufferAttribute(s,y),f.fromBufferAttribute(s,w),p.fromBufferAttribute(s,C),c.sub(h),d.sub(h),f.sub(u),p.sub(u);const R=1/(f.x*p.y-p.x*f.y);isFinite(R)&&(x.copy(c).multiplyScalar(p.y).addScaledVector(d,-f.y).multiplyScalar(R),m.copy(d).multiplyScalar(f.x).addScaledVector(c,-p.x).multiplyScalar(R),o[y].add(x),o[w].add(x),o[C].add(x),l[y].add(m),l[w].add(m),l[C].add(m))}let v=this.groups;v.length===0&&(v=[{start:0,count:t.count}]);for(let y=0,w=v.length;y<w;++y){const C=v[y],R=C.start,I=C.count;for(let z=R,G=R+I;z<G;z+=3)g(t.getX(z+0),t.getX(z+1),t.getX(z+2))}const S=new Z,_=new Z,E=new Z,b=new Z;function A(y){E.fromBufferAttribute(n,y),b.copy(E);const w=o[y];S.copy(w),S.sub(E.multiplyScalar(E.dot(w))).normalize(),_.crossVectors(b,w);const R=_.dot(l[y])<0?-1:1;a.setXYZW(y,S.x,S.y,S.z,R)}for(let y=0,w=v.length;y<w;++y){const C=v[y],R=C.start,I=C.count;for(let z=R,G=R+I;z<G;z+=3)A(t.getX(z+0)),A(t.getX(z+1)),A(t.getX(z+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==e.count)i=new ei(new Float32Array(e.count*3),3),this.setAttribute("normal",i);else for(let u=0,f=i.count;u<f;u++)i.setXYZ(u,0,0,0);const n=new Z,s=new Z,a=new Z,o=new Z,l=new Z,h=new Z,c=new Z,d=new Z;if(t)for(let u=0,f=t.count;u<f;u+=3){const p=t.getX(u+0),x=t.getX(u+1),m=t.getX(u+2);n.fromBufferAttribute(e,p),s.fromBufferAttribute(e,x),a.fromBufferAttribute(e,m),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),o.fromBufferAttribute(i,p),l.fromBufferAttribute(i,x),h.fromBufferAttribute(i,m),o.add(c),l.add(c),h.add(c),i.setXYZ(p,o.x,o.y,o.z),i.setXYZ(x,l.x,l.y,l.z),i.setXYZ(m,h.x,h.y,h.z)}else for(let u=0,f=e.count;u<f;u+=3)n.fromBufferAttribute(e,u+0),s.fromBufferAttribute(e,u+1),a.fromBufferAttribute(e,u+2),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),i.setXYZ(u+0,c.x,c.y,c.z),i.setXYZ(u+1,c.x,c.y,c.z),i.setXYZ(u+2,c.x,c.y,c.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,i=t.count;e<i;e++)Ue.fromBufferAttribute(t,e),Ue.normalize(),t.setXYZ(e,Ue.x,Ue.y,Ue.z)}toNonIndexed(){function t(o,l){const h=o.array,c=o.itemSize,d=o.normalized,u=new h.constructor(l.length*c);let f=0,p=0;for(let x=0,m=l.length;x<m;x++){o.isInterleavedBufferAttribute?f=l[x]*o.data.stride+o.offset:f=l[x]*c;for(let g=0;g<c;g++)u[p++]=h[f++]}return new ei(u,c,d)}if(this.index===null)return ke("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new ze,i=this.index.array,n=this.attributes;for(const o in n){const l=n[o],h=t(l,i);e.setAttribute(o,h)}const s=this.morphAttributes;for(const o in s){const l=[],h=s[o];for(let c=0,d=h.length;c<d;c++){const u=h[c],f=t(u,i);l.push(f)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const h=a[o];e.addGroup(h.start,h.count,h.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const l=this.parameters;for(const h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const i=this.attributes;for(const l in i){const h=i[l];t.data.attributes[l]=h.toJSON(t.data)}const n={};let s=!1;for(const l in this.morphAttributes){const h=this.morphAttributes[l],c=[];for(let d=0,u=h.length;d<u;d++){const f=h[d];c.push(f.toJSON(t.data))}c.length>0&&(n[l]=c,s=!0)}s&&(t.data.morphAttributes=n,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const i=t.index;i!==null&&this.setIndex(i.clone());const n=t.attributes;for(const h in n){const c=n[h];this.setAttribute(h,c.clone(e))}const s=t.morphAttributes;for(const h in s){const c=[],d=s[h];for(let u=0,f=d.length;u<f;u++)c.push(d[u].clone(e));this.morphAttributes[h]=c}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let h=0,c=a.length;h<c;h++){const d=a[h];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}}class AM{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=ec,this.updateRanges=[],this.version=0,this.uuid=Nn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,i){t*=this.stride,i*=e.stride;for(let n=0,s=this.stride;n<s;n++)this.array[t+n]=e.array[i+n];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Nn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),i=new this.constructor(e,this.stride);return i.setUsage(this.usage),i}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Nn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const $e=new Z;class zo{constructor(t,e,i,n=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=i,this.normalized=n}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,i=this.data.count;e<i;e++)$e.fromBufferAttribute(this,e),$e.applyMatrix4(t),this.setXYZ(e,$e.x,$e.y,$e.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)$e.fromBufferAttribute(this,e),$e.applyNormalMatrix(t),this.setXYZ(e,$e.x,$e.y,$e.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)$e.fromBufferAttribute(this,e),$e.transformDirection(t),this.setXYZ(e,$e.x,$e.y,$e.z);return this}getComponent(t,e){let i=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(i=Oi(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=ae(i,this.array)),this.data.array[t*this.data.stride+this.offset+e]=i,this}setX(t,e){return this.normalized&&(e=ae(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=ae(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=ae(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=ae(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=Oi(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=Oi(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=Oi(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=Oi(e,this.array)),e}setXY(t,e,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=ae(e,this.array),i=ae(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this}setXYZ(t,e,i,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=ae(e,this.array),i=ae(i,this.array),n=ae(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this.data.array[t+2]=n,this}setXYZW(t,e,i,n,s){return t=t*this.data.stride+this.offset,this.normalized&&(e=ae(e,this.array),i=ae(i,this.array),n=ae(n,this.array),s=ae(s,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this.data.array[t+2]=n,this.data.array[t+3]=s,this}clone(t){if(t===void 0){bd("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let i=0;i<this.count;i++){const n=i*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[n+s])}return new ei(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new zo(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){bd("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let i=0;i<this.count;i++){const n=i*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[n+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}let CM=0;class Xo extends br{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:CM++}),this.uuid=Nn(),this.name="",this.type="Material",this.blending=Uo,this.side=gr,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=hd,this.blendDst=cd,this.blendEquation=ld,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new ti(0,0,0),this.blendAlpha=0,this.depthFunc=ud,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=yd,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Ds,this.stencilZFail=Ds,this.stencilZPass=Ds,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const i=t[e];if(i===void 0){ke(`Material: parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){ke(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}n&&n.isColor?n.set(i):n&&n.isVector2&&i&&i.isVector2||n&&n.isEuler&&i&&i.isEuler||n&&n.isVector3&&i&&i.isVector3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==Uo&&(i.blending=this.blending),this.side!==gr&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==hd&&(i.blendSrc=this.blendSrc),this.blendDst!==cd&&(i.blendDst=this.blendDst),this.blendEquation!==ld&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==ud&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==yd&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Ds&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Ds&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Ds&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function n(s){const a=[];for(const o in s){const l=s[o];delete l.metadata,a.push(l)}return a}if(e){const s=n(t.textures),a=n(t.images);s.length>0&&(i.textures=s),a.length>0&&(i.images=a)}return i}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new ti().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new ne().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new ne().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let i=null;if(e!==null){const n=e.length;i=new Array(n);for(let s=0;s!==n;++s)i[s]=e[s].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}}class Rc extends Xo{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new ti(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let Hs;const Or=new Z,Ws=new Z,Xs=new Z,qs=new ne,kr=new ne,pp=new Ie,$a=new Z,Br=new Z,Ya=new Z,Fd=new ne,$l=new ne,Ud=new ne;class mp extends Je{constructor(t=new Rc){if(super(),this.isSprite=!0,this.type="Sprite",Hs===void 0){Hs=new ze;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),i=new AM(e,5);Hs.setIndex([0,1,2,0,2,3]),Hs.setAttribute("position",new zo(i,3,0,!1)),Hs.setAttribute("uv",new zo(i,2,3,!1))}this.geometry=Hs,this.material=t,this.center=new ne(.5,.5),this.count=1}raycast(t,e){t.camera===null&&In('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Ws.setFromMatrixScale(this.matrixWorld),pp.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),Xs.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Ws.multiplyScalar(-Xs.z);const i=this.material.rotation;let n,s;i!==0&&(s=Math.cos(i),n=Math.sin(i));const a=this.center;Za($a.set(-.5,-.5,0),Xs,a,Ws,n,s),Za(Br.set(.5,-.5,0),Xs,a,Ws,n,s),Za(Ya.set(.5,.5,0),Xs,a,Ws,n,s),Fd.set(0,0),$l.set(1,0),Ud.set(1,1);let o=t.ray.intersectTriangle($a,Br,Ya,!1,Or);if(o===null&&(Za(Br.set(-.5,.5,0),Xs,a,Ws,n,s),$l.set(0,1),o=t.ray.intersectTriangle($a,Ya,Br,!1,Or),o===null))return;const l=t.ray.origin.distanceTo(Or);l<t.near||l>t.far||e.push({distance:l,point:Or.clone(),uv:mi.getInterpolation(Or,$a,Br,Ya,Fd,$l,Ud,new ne),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function Za(r,t,e,i,n,s){qs.subVectors(r,e).addScalar(.5).multiply(i),n!==void 0?(kr.x=s*qs.x-n*qs.y,kr.y=n*qs.x+s*qs.y):kr.copy(qs),r.copy(t),r.x+=kr.x,r.y+=kr.y,r.applyMatrix4(pp)}const ji=new Z,Yl=new Z,Ka=new Z,wn=new Z,Zl=new Z,Ja=new Z,Kl=new Z;class gp{constructor(t=new Z,e=new Z(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,ji)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const i=e.dot(this.direction);return i<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=ji.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(ji.copy(this.origin).addScaledVector(this.direction,e),ji.distanceToSquared(t))}distanceSqToSegment(t,e,i,n){Yl.copy(t).add(e).multiplyScalar(.5),Ka.copy(e).sub(t).normalize(),wn.copy(this.origin).sub(Yl);const s=t.distanceTo(e)*.5,a=-this.direction.dot(Ka),o=wn.dot(this.direction),l=-wn.dot(Ka),h=wn.lengthSq(),c=Math.abs(1-a*a);let d,u,f,p;if(c>0)if(d=a*l-o,u=a*o-l,p=s*c,d>=0)if(u>=-p)if(u<=p){const x=1/c;d*=x,u*=x,f=d*(d+a*u+2*o)+u*(a*d+u+2*l)+h}else u=s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u=-s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u<=-p?(d=Math.max(0,-(-a*s+o)),u=d>0?-s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h):u<=p?(d=0,u=Math.min(Math.max(-s,-l),s),f=u*(u+2*l)+h):(d=Math.max(0,-(a*s+o)),u=d>0?s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h);else u=a>0?-s:s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;return i&&i.copy(this.origin).addScaledVector(this.direction,d),n&&n.copy(Yl).addScaledVector(Ka,u),f}intersectSphere(t,e){ji.subVectors(t.center,this.origin);const i=ji.dot(this.direction),n=ji.dot(ji)-i*i,s=t.radius*t.radius;if(n>s)return null;const a=Math.sqrt(s-n),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(t.normal)+t.constant)/e;return i>=0?i:null}intersectPlane(t,e){const i=this.distanceToPlane(t);return i===null?null:this.at(i,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let i,n,s,a,o,l;const h=1/this.direction.x,c=1/this.direction.y,d=1/this.direction.z,u=this.origin;return h>=0?(i=(t.min.x-u.x)*h,n=(t.max.x-u.x)*h):(i=(t.max.x-u.x)*h,n=(t.min.x-u.x)*h),c>=0?(s=(t.min.y-u.y)*c,a=(t.max.y-u.y)*c):(s=(t.max.y-u.y)*c,a=(t.min.y-u.y)*c),i>a||s>n||((s>i||isNaN(i))&&(i=s),(a<n||isNaN(n))&&(n=a),d>=0?(o=(t.min.z-u.z)*d,l=(t.max.z-u.z)*d):(o=(t.max.z-u.z)*d,l=(t.min.z-u.z)*d),i>l||o>n)||((o>i||i!==i)&&(i=o),(l<n||n!==n)&&(n=l),n<0)?null:this.at(i>=0?i:n,e)}intersectsBox(t){return this.intersectBox(t,ji)!==null}intersectTriangle(t,e,i,n,s){Zl.subVectors(e,t),Ja.subVectors(i,t),Kl.crossVectors(Zl,Ja);let a=this.direction.dot(Kl),o;if(a>0){if(n)return null;o=1}else if(a<0)o=-1,a=-a;else return null;wn.subVectors(this.origin,t);const l=o*this.direction.dot(Ja.crossVectors(wn,Ja));if(l<0)return null;const h=o*this.direction.dot(Zl.cross(wn));if(h<0||l+h>a)return null;const c=-o*wn.dot(Kl);return c<0?null:this.at(c/a,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class ea extends Xo{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new ti(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new as,this.combine=eM,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const zd=new Ie,Jn=new gp,Qa=new Sr,Od=new Z,ja=new Z,to=new Z,eo=new Z,Jl=new Z,io=new Z,kd=new Z,no=new Z;class Jt extends Je{constructor(t=new ze,e=new ea){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=n.length;s<a;s++){const o=n[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(t,e){const i=this.geometry,n=i.attributes.position,s=i.morphAttributes.position,a=i.morphTargetsRelative;e.fromBufferAttribute(n,t);const o=this.morphTargetInfluences;if(s&&o){io.set(0,0,0);for(let l=0,h=s.length;l<h;l++){const c=o[l],d=s[l];c!==0&&(Jl.fromBufferAttribute(d,t),a?io.addScaledVector(Jl,c):io.addScaledVector(Jl.sub(e),c))}e.add(io)}return e}raycast(t,e){const i=this.geometry,n=this.material,s=this.matrixWorld;n!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Qa.copy(i.boundingSphere),Qa.applyMatrix4(s),Jn.copy(t.ray).recast(t.near),!(Qa.containsPoint(Jn.origin)===!1&&(Jn.intersectSphere(Qa,Od)===null||Jn.origin.distanceToSquared(Od)>(t.far-t.near)**2))&&(zd.copy(s).invert(),Jn.copy(t.ray).applyMatrix4(zd),!(i.boundingBox!==null&&Jn.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,e,Jn)))}_computeIntersections(t,e,i){let n;const s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,h=s.attributes.uv,c=s.attributes.uv1,d=s.attributes.normal,u=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const m=u[p],g=a[m.materialIndex],v=Math.max(m.start,f.start),S=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let _=v,E=S;_<E;_+=3){const b=o.getX(_),A=o.getX(_+1),y=o.getX(_+2);n=so(this,g,t,i,h,c,d,b,A,y),n&&(n.faceIndex=Math.floor(_/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(o.count,f.start+f.count);for(let m=p,g=x;m<g;m+=3){const v=o.getX(m),S=o.getX(m+1),_=o.getX(m+2);n=so(this,a,t,i,h,c,d,v,S,_),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}else if(l!==void 0)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const m=u[p],g=a[m.materialIndex],v=Math.max(m.start,f.start),S=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let _=v,E=S;_<E;_+=3){const b=_,A=_+1,y=_+2;n=so(this,g,t,i,h,c,d,b,A,y),n&&(n.faceIndex=Math.floor(_/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(l.count,f.start+f.count);for(let m=p,g=x;m<g;m+=3){const v=m,S=m+1,_=m+2;n=so(this,a,t,i,h,c,d,v,S,_),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}}}function RM(r,t,e,i,n,s,a,o){let l;if(t.side===tM?l=i.intersectTriangle(a,s,n,!0,o):l=i.intersectTriangle(n,s,a,t.side===gr,o),l===null)return null;no.copy(o),no.applyMatrix4(r.matrixWorld);const h=e.ray.origin.distanceTo(no);return h<e.near||h>e.far?null:{distance:h,point:no.clone(),object:r}}function so(r,t,e,i,n,s,a,o,l,h){r.getVertexPosition(o,ja),r.getVertexPosition(l,to),r.getVertexPosition(h,eo);const c=RM(r,t,e,i,ja,to,eo,kd);if(c){const d=new Z;mi.getBarycoord(kd,ja,to,eo,d),n&&(c.uv=mi.getInterpolatedAttribute(n,o,l,h,d,new ne)),s&&(c.uv1=mi.getInterpolatedAttribute(s,o,l,h,d,new ne)),a&&(c.normal=mi.getInterpolatedAttribute(a,o,l,h,d,new Z),c.normal.dot(i.direction)>0&&c.normal.multiplyScalar(-1));const u={a:o,b:l,c:h,normal:new Z,materialIndex:0};mi.getNormal(ja,to,eo,u.normal),c.face=u,c.barycoord=d}return c}class PM extends Vi{constructor(t=null,e=1,i=1,n,s,a,o,l,h=pd,c=pd,d,u){super(null,a,o,l,h,c,n,s,d,u),this.isDataTexture=!0,this.image={data:t,width:e,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Bd extends ei{constructor(t,e,i,n=1){super(t,e,i),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=n}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const $s=new Ie,Vd=new Ie,ro=[],Gd=new cs,IM=new Ie,Vr=new Jt,Gr=new Sr;class DM extends Jt{constructor(t,e,i){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Bd(new Float32Array(i*16),16),this.instanceColor=null,this.morphTexture=null,this.count=i,this.boundingBox=null,this.boundingSphere=null;for(let n=0;n<i;n++)this.setMatrixAt(n,IM)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new cs),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,$s),Gd.copy(t.boundingBox).applyMatrix4($s),this.boundingBox.union(Gd)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new Sr),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,$s),Gr.copy(t.boundingSphere).applyMatrix4($s),this.boundingSphere.union(Gr)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const i=e.morphTargetInfluences,n=this.morphTexture.source.data.data,s=i.length+1,a=t*s+1;for(let o=0;o<i.length;o++)i[o]=n[a+o]}raycast(t,e){const i=this.matrixWorld,n=this.count;if(Vr.geometry=this.geometry,Vr.material=this.material,Vr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Gr.copy(this.boundingSphere),Gr.applyMatrix4(i),t.ray.intersectsSphere(Gr)!==!1))for(let s=0;s<n;s++){this.getMatrixAt(s,$s),Vd.multiplyMatrices(i,$s),Vr.matrixWorld=Vd,Vr.raycast(t,ro);for(let a=0,o=ro.length;a<o;a++){const l=ro[a];l.instanceId=s,l.object=this,e.push(l)}ro.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new Bd(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){const i=e.morphTargetInfluences,n=i.length+1;this.morphTexture===null&&(this.morphTexture=new PM(new Float32Array(n*this.count),n,this.count,rM,hp));const s=this.morphTexture.source.data.data;let a=0;for(let h=0;h<i.length;h++)a+=i[h];const o=this.geometry.morphTargetsRelative?1:1-a,l=n*t;return s[l]=o,s.set(i,l+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}class LM extends Xo{constructor(t){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new ti(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}const Hd=new Ie,ic=new gp,ao=new Sr,oo=new Z;class Ql extends Je{constructor(t=new ze,e=new LM){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}raycast(t,e){const i=this.geometry,n=this.matrixWorld,s=t.params.Points.threshold,a=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),ao.copy(i.boundingSphere),ao.applyMatrix4(n),ao.radius+=s,t.ray.intersectsSphere(ao)===!1)return;Hd.copy(n).invert(),ic.copy(t.ray).applyMatrix4(Hd);const o=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,h=i.index,d=i.attributes.position;if(h!==null){const u=Math.max(0,a.start),f=Math.min(h.count,a.start+a.count);for(let p=u,x=f;p<x;p++){const m=h.getX(p);oo.fromBufferAttribute(d,m),Wd(oo,m,l,n,t,e,this)}}else{const u=Math.max(0,a.start),f=Math.min(d.count,a.start+a.count);for(let p=u,x=f;p<x;p++)oo.fromBufferAttribute(d,p),Wd(oo,p,l,n,t,e,this)}}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=n.length;s<a;s++){const o=n[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}}function Wd(r,t,e,i,n,s,a){const o=ic.distanceSqToPoint(r);if(o<e){const l=new Z;ic.closestPointToPoint(r,l),l.applyMatrix4(i);const h=n.ray.origin.distanceTo(l);if(h<n.near||h>n.far)return;s.push({distance:h,distanceToRay:Math.sqrt(o),point:l,index:t,face:null,faceIndex:null,barycoord:null,object:a})}}class Pc extends Vi{constructor(t,e,i,n,s,a,o,l,h){super(t,e,i,n,s,a,o,l,h),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Ic extends ze{constructor(t=1,e=1,i=4,n=8,s=1){super(),this.type="CapsuleGeometry",this.parameters={radius:t,height:e,capSegments:i,radialSegments:n,heightSegments:s},e=Math.max(0,e),i=Math.max(1,Math.floor(i)),n=Math.max(3,Math.floor(n)),s=Math.max(1,Math.floor(s));const a=[],o=[],l=[],h=[],c=e/2,d=Math.PI/2*t,u=e,f=2*d+u,p=i*2+s,x=n+1,m=new Z,g=new Z;for(let v=0;v<=p;v++){let S=0,_=0,E=0,b=0;if(v<=i){const w=v/i,C=w*Math.PI/2;_=-c-t*Math.cos(C),E=t*Math.sin(C),b=-t*Math.cos(C),S=w*d}else if(v<=i+s){const w=(v-i)/s;_=-c+w*e,E=t,b=0,S=d+w*u}else{const w=(v-i-s)/i,C=w*Math.PI/2;_=c+t*Math.sin(C),E=t*Math.cos(C),b=t*Math.sin(C),S=d+u+w*d}const A=Math.max(0,Math.min(1,S/f));let y=0;v===0?y=.5/n:v===p&&(y=-.5/n);for(let w=0;w<=n;w++){const C=w/n,R=C*Math.PI*2,I=Math.sin(R),z=Math.cos(R);g.x=-E*z,g.y=_,g.z=E*I,o.push(g.x,g.y,g.z),m.set(-E*z,b,E*I),m.normalize(),l.push(m.x,m.y,m.z),h.push(C+y,A)}if(v>0){const w=(v-1)*x;for(let C=0;C<n;C++){const R=w+C,I=w+C+1,z=v*x+C,G=v*x+C+1;a.push(R,I,z),a.push(I,G,z)}}}this.setIndex(a),this.setAttribute("position",new ge(o,3)),this.setAttribute("normal",new ge(l,3)),this.setAttribute("uv",new ge(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Ic(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}}class kn extends ze{constructor(t=1,e=1,i=1,n=32,s=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:i,radialSegments:n,heightSegments:s,openEnded:a,thetaStart:o,thetaLength:l};const h=this;n=Math.floor(n),s=Math.floor(s);const c=[],d=[],u=[],f=[];let p=0;const x=[],m=i/2;let g=0;v(),a===!1&&(t>0&&S(!0),e>0&&S(!1)),this.setIndex(c),this.setAttribute("position",new ge(d,3)),this.setAttribute("normal",new ge(u,3)),this.setAttribute("uv",new ge(f,2));function v(){const _=new Z,E=new Z;let b=0;const A=(e-t)/i;for(let y=0;y<=s;y++){const w=[],C=y/s,R=C*(e-t)+t;for(let I=0;I<=n;I++){const z=I/n,G=z*l+o,L=Math.sin(G),N=Math.cos(G);E.x=R*L,E.y=-C*i+m,E.z=R*N,d.push(E.x,E.y,E.z),_.set(L,A,N).normalize(),u.push(_.x,_.y,_.z),f.push(z,1-C),w.push(p++)}x.push(w)}for(let y=0;y<n;y++)for(let w=0;w<s;w++){const C=x[w][y],R=x[w+1][y],I=x[w+1][y+1],z=x[w][y+1];(t>0||w!==0)&&(c.push(C,R,z),b+=3),(e>0||w!==s-1)&&(c.push(R,I,z),b+=3)}h.addGroup(g,b,0),g+=b}function S(_){const E=p,b=new ne,A=new Z;let y=0;const w=_===!0?t:e,C=_===!0?1:-1;for(let I=1;I<=n;I++)d.push(0,m*C,0),u.push(0,C,0),f.push(.5,.5),p++;const R=p;for(let I=0;I<=n;I++){const G=I/n*l+o,L=Math.cos(G),N=Math.sin(G);A.x=w*N,A.y=m*C,A.z=w*L,d.push(A.x,A.y,A.z),u.push(0,C,0),b.x=L*.5+.5,b.y=N*.5*C+.5,f.push(b.x,b.y),p++}for(let I=0;I<n;I++){const z=E+I,G=R+I;_===!0?c.push(G,G+1,z):c.push(G+1,G,z),y+=3}h.addGroup(g,y,_===!0?1:2),g+=y}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new kn(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Ln extends kn{constructor(t=1,e=1,i=32,n=1,s=!1,a=0,o=Math.PI*2){super(0,t,e,i,n,s,a,o),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:i,heightSegments:n,openEnded:s,thetaStart:a,thetaLength:o}}static fromJSON(t){return new Ln(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Dc extends ze{constructor(t=[],e=[],i=1,n=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:i,detail:n};const s=[],a=[];o(n),h(i),c(),this.setAttribute("position",new ge(s,3)),this.setAttribute("normal",new ge(s.slice(),3)),this.setAttribute("uv",new ge(a,2)),n===0?this.computeVertexNormals():this.normalizeNormals();function o(v){const S=new Z,_=new Z,E=new Z;for(let b=0;b<e.length;b+=3)f(e[b+0],S),f(e[b+1],_),f(e[b+2],E),l(S,_,E,v)}function l(v,S,_,E){const b=E+1,A=[];for(let y=0;y<=b;y++){A[y]=[];const w=v.clone().lerp(_,y/b),C=S.clone().lerp(_,y/b),R=b-y;for(let I=0;I<=R;I++)I===0&&y===b?A[y][I]=w:A[y][I]=w.clone().lerp(C,I/R)}for(let y=0;y<b;y++)for(let w=0;w<2*(b-y)-1;w++){const C=Math.floor(w/2);w%2===0?(u(A[y][C+1]),u(A[y+1][C]),u(A[y][C])):(u(A[y][C+1]),u(A[y+1][C+1]),u(A[y+1][C]))}}function h(v){const S=new Z;for(let _=0;_<s.length;_+=3)S.x=s[_+0],S.y=s[_+1],S.z=s[_+2],S.normalize().multiplyScalar(v),s[_+0]=S.x,s[_+1]=S.y,s[_+2]=S.z}function c(){const v=new Z;for(let S=0;S<s.length;S+=3){v.x=s[S+0],v.y=s[S+1],v.z=s[S+2];const _=m(v)/2/Math.PI+.5,E=g(v)/Math.PI+.5;a.push(_,1-E)}p(),d()}function d(){for(let v=0;v<a.length;v+=6){const S=a[v+0],_=a[v+2],E=a[v+4],b=Math.max(S,_,E),A=Math.min(S,_,E);b>.9&&A<.1&&(S<.2&&(a[v+0]+=1),_<.2&&(a[v+2]+=1),E<.2&&(a[v+4]+=1))}}function u(v){s.push(v.x,v.y,v.z)}function f(v,S){const _=v*3;S.x=t[_+0],S.y=t[_+1],S.z=t[_+2]}function p(){const v=new Z,S=new Z,_=new Z,E=new Z,b=new ne,A=new ne,y=new ne;for(let w=0,C=0;w<s.length;w+=9,C+=6){v.set(s[w+0],s[w+1],s[w+2]),S.set(s[w+3],s[w+4],s[w+5]),_.set(s[w+6],s[w+7],s[w+8]),b.set(a[C+0],a[C+1]),A.set(a[C+2],a[C+3]),y.set(a[C+4],a[C+5]),E.copy(v).add(S).add(_).divideScalar(3);const R=m(E);x(b,C+0,v,R),x(A,C+2,S,R),x(y,C+4,_,R)}}function x(v,S,_,E){E<0&&v.x===1&&(a[S]=v.x-1),_.x===0&&_.z===0&&(a[S]=E/2/Math.PI+.5)}function m(v){return Math.atan2(v.z,-v.x)}function g(v){return Math.atan2(-v.y,Math.sqrt(v.x*v.x+v.z*v.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Dc(t.vertices,t.indices,t.radius,t.detail)}}class Lc extends Dc{constructor(t=1,e=0){const i=(1+Math.sqrt(5))/2,n=[-1,i,0,1,i,0,-1,-i,0,1,-i,0,0,-1,i,0,1,i,0,-1,-i,0,1,-i,i,0,-1,i,0,1,-i,0,-1,-i,0,1],s=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(n,s,t,e),this.type="IcosahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new Lc(t.radius,t.detail)}}class ua extends ze{constructor(t=1,e=1,i=1,n=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:i,heightSegments:n};const s=t/2,a=e/2,o=Math.floor(i),l=Math.floor(n),h=o+1,c=l+1,d=t/o,u=e/l,f=[],p=[],x=[],m=[];for(let g=0;g<c;g++){const v=g*u-a;for(let S=0;S<h;S++){const _=S*d-s;p.push(_,-v,0),x.push(0,0,1),m.push(S/o),m.push(1-g/l)}}for(let g=0;g<l;g++)for(let v=0;v<o;v++){const S=v+h*g,_=v+h*(g+1),E=v+1+h*(g+1),b=v+1+h*g;f.push(S,_,b),f.push(_,E,b)}this.setIndex(f),this.setAttribute("position",new ge(p,3)),this.setAttribute("normal",new ge(x,3)),this.setAttribute("uv",new ge(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ua(t.width,t.height,t.widthSegments,t.heightSegments)}}class ci extends ze{constructor(t=1,e=32,i=16,n=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:i,phiStart:n,phiLength:s,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),i=Math.max(2,Math.floor(i));const l=Math.min(a+o,Math.PI);let h=0;const c=[],d=new Z,u=new Z,f=[],p=[],x=[],m=[];for(let g=0;g<=i;g++){const v=[],S=g/i,_=a+S*o,E=t*Math.cos(_),b=Math.sqrt(t*t-E*E);let A=0;g===0&&a===0?A=.5/e:g===i&&l===Math.PI&&(A=-.5/e);for(let y=0;y<=e;y++){const w=y/e,C=n+w*s;d.x=-b*Math.cos(C),d.y=E,d.z=b*Math.sin(C),p.push(d.x,d.y,d.z),u.copy(d).normalize(),x.push(u.x,u.y,u.z),m.push(w+A,1-S),v.push(h++)}c.push(v)}for(let g=0;g<i;g++)for(let v=0;v<e;v++){const S=c[g][v+1],_=c[g][v],E=c[g+1][v],b=c[g+1][v+1];(g!==0||a>0)&&f.push(S,_,b),(g!==i-1||l<Math.PI)&&f.push(_,E,b)}this.setIndex(f),this.setAttribute("position",new ge(p,3)),this.setAttribute("normal",new ge(x,3)),this.setAttribute("uv",new ge(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ci(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class Oo extends ze{constructor(t=1,e=.4,i=12,n=48,s=Math.PI*2,a=0,o=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:i,tubularSegments:n,arc:s,thetaStart:a,thetaLength:o},i=Math.floor(i),n=Math.floor(n);const l=[],h=[],c=[],d=[],u=new Z,f=new Z,p=new Z;for(let x=0;x<=i;x++){const m=a+x/i*o;for(let g=0;g<=n;g++){const v=g/n*s;f.x=(t+e*Math.cos(m))*Math.cos(v),f.y=(t+e*Math.cos(m))*Math.sin(v),f.z=e*Math.sin(m),h.push(f.x,f.y,f.z),u.x=t*Math.cos(v),u.y=t*Math.sin(v),p.subVectors(f,u).normalize(),c.push(p.x,p.y,p.z),d.push(g/n),d.push(x/i)}}for(let x=1;x<=i;x++)for(let m=1;m<=n;m++){const g=(n+1)*x+m-1,v=(n+1)*(x-1)+m-1,S=(n+1)*(x-1)+m,_=(n+1)*x+m;l.push(g,v,_),l.push(v,S,_)}this.setIndex(l),this.setAttribute("position",new ge(h,3)),this.setAttribute("normal",new ge(c,3)),this.setAttribute("uv",new ge(d,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Oo(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}}function NM(r){const t={};for(const e in r){t[e]={};for(const i in r[e]){const n=r[e][i];if(Xd(n))n.isRenderTargetTexture?(ke("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][i]=null):t[e][i]=n.clone();else if(Array.isArray(n))if(Xd(n[0])){const s=[];for(let a=0,o=n.length;a<o;a++)s[a]=n[a].clone();t[e][i]=s}else t[e][i]=n.slice();else t[e][i]=n}}return t}function Xd(r){return r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)}function FM(r){const t=[];for(let e=0;e<r.length;e++)t.push(r[e].clone());return t}var UM=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,zM=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class xr extends Xo{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=UM,this.fragmentShader=zM,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=NM(t.uniforms),this.uniformsGroups=FM(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const n in this.uniforms){const a=this.uniforms[n].value;a&&a.isTexture?e.uniforms[n]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[n]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[n]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[n]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[n]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[n]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[n]={type:"m4",value:a.toArray()}:e.uniforms[n]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const i={};for(const n in this.extensions)this.extensions[n]===!0&&(i[n]=!0);return Object.keys(i).length>0&&(e.extensions=i),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const i in t.uniforms){const n=t.uniforms[i];switch(this.uniforms[i]={},n.type){case"t":this.uniforms[i].value=e[n.value]||null;break;case"c":this.uniforms[i].value=new ti().setHex(n.value);break;case"v2":this.uniforms[i].value=new ne().fromArray(n.value);break;case"v3":this.uniforms[i].value=new Z().fromArray(n.value);break;case"v4":this.uniforms[i].value=new Hi().fromArray(n.value);break;case"m3":this.uniforms[i].value=new cn().fromArray(n.value);break;case"m4":this.uniforms[i].value=new Ie().fromArray(n.value);break;default:this.uniforms[i].value=n.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}}const lo=new Z,ho=new Gn,Ui=new Z;class OM extends Je{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Ie,this.projectionMatrix=new Ie,this.projectionMatrixInverse=new Ie,this.coordinateSystem=Zr,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(lo,ho,Ui),Ui.x===1&&Ui.y===1&&Ui.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lo,ho,Ui.set(1,1,1)).invert()}updateWorldMatrix(t,e,i=!1){super.updateWorldMatrix(t,e,i),this.matrixWorld.decompose(lo,ho,Ui),Ui.x===1&&Ui.y===1&&Ui.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(lo,ho,Ui.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}}class kM extends OM{constructor(t=-1,e=1,i=1,n=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=i,this.bottom=n,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,i,n,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,n=(this.top+this.bottom)/2;let s=i-t,a=i+t,o=n+e,l=n-e;if(this.view!==null&&this.view.enabled){const h=(this.right-this.left)/this.view.fullWidth/this.zoom,c=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=h*this.view.offsetX,a=s+h*this.view.width,o-=c*this.view.offsetY,l=o-c*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}class xp{static{xp.prototype.isMatrix2=!0}constructor(t,e,i,n){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,i,n)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let i=0;i<4;i++)this.elements[i]=t[i+e];return this}set(t,e,i,n){const s=this.elements;return s[0]=t,s[2]=e,s[1]=i,s[3]=n,this}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:op}}));typeof window<"u"&&(window.__THREE__?ke("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=op);const qd=`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`,BM=`
  uniform sampler2D tSrc;
  uniform vec2 uDir;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  vec3 bright(vec3 c) {
    float l = max(c.r, max(c.g, c.b));
    float k = smoothstep(uThreshold, uThreshold + uKnee, l);
    return c * k;
  }
  void main() {
    // 9-tap gaussian along uDir; the first pass also keeps only bright texels.
    vec3 s = vec3(0.0);
    float w[5]; w[0] = 0.227; w[1] = 0.1945; w[2] = 0.1216; w[3] = 0.054; w[4] = 0.0162;
    vec3 c0 = texture2D(tSrc, vUv).rgb;
    s += (uThreshold > 0.0 ? bright(c0) : c0) * w[0];
    for (int i = 1; i < 5; i++) {
      vec2 o = uDir * float(i);
      vec3 a = texture2D(tSrc, vUv + o).rgb; vec3 b = texture2D(tSrc, vUv - o).rgb;
      if (uThreshold > 0.0) { a = bright(a); b = bright(b); }
      s += (a + b) * w[i];
    }
    gl_FragColor = vec4(s, 1.0);
  }
`,VM=`
  uniform sampler2D tNear;
  uniform sampler2D tWide;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tNear, vUv).rgb * 0.65 + texture2D(tWide, vUv).rgb * 0.55;
    gl_FragColor = vec4(c * uStrength, 1.0);
  }
`;class GM{constructor(t,{strength:e=.9,threshold:i=.45,knee:n=.35,scale:s=.25}={}){this.renderer=t,this.enabled=!0,this.scale=s;const a=()=>new Td(1,1,{type:md,depthBuffer:!1,generateMipmaps:!1});this.scene=new Td(1,1,{type:md,generateMipmaps:!1}),this.a=a(),this.b=a(),this.c=a(),this.d=a(),this.blur=new xr({vertexShader:qd,fragmentShader:BM,uniforms:{tSrc:{value:null},uDir:{value:new ne},uThreshold:{value:i},uKnee:{value:n}},depthTest:!1,depthWrite:!1}),this.composite=new xr({vertexShader:qd,fragmentShader:VM,uniforms:{tNear:{value:this.b.texture},tWide:{value:this.d.texture},uStrength:{value:e}},depthTest:!1,depthWrite:!1,transparent:!0,blending:On}),this.threshold=i,this.quad=new Jt(new ua(2,2),this.blur),this.quad.frustumCulled=!1,this.quadScene=new MM,this.quadScene.add(this.quad),this.quadCam=new kM(-1,1,1,-1,0,1),this.size=new ne,this.w=0,this.h=0}#e(){this.renderer.getSize(this.size);const t=Math.max(16,Math.round(this.size.x*this.scale)),e=Math.max(16,Math.round(this.size.y*this.scale));t===this.w&&e===this.h||(this.w=t,this.h=e,this.scene.setSize(t,e),this.a.setSize(t,e),this.b.setSize(t,e),this.c.setSize(Math.max(8,t>>1),Math.max(8,e>>1)),this.d.setSize(Math.max(8,t>>1),Math.max(8,e>>1)))}#i(t,e,i){i(),this.quad.material=t,this.renderer.setRenderTarget(e),this.renderer.render(this.quadScene,this.quadCam)}apply(t,e,i){if(!this.enabled)return;const n=this.renderer,s=n.getRenderTarget(),a=n.autoClear;this.#e(),n.setRenderTarget(this.scene),n.autoClear=!0,t(e,i);const o=this.blur.uniforms;this.#i(this.blur,this.a,()=>{o.tSrc.value=this.scene.texture,o.uDir.value.set(1.4/this.w,0),o.uThreshold.value=this.threshold}),this.#i(this.blur,this.b,()=>{o.tSrc.value=this.a.texture,o.uDir.value.set(0,1.4/this.h),o.uThreshold.value=0}),this.#i(this.blur,this.c,()=>{o.tSrc.value=this.b.texture,o.uDir.value.set(2.2/this.c.width,0),o.uThreshold.value=0}),this.#i(this.blur,this.d,()=>{o.tSrc.value=this.c.texture,o.uDir.value.set(0,2.2/this.c.height),o.uThreshold.value=0}),n.setRenderTarget(s),n.autoClear=!1,this.quad.material=this.composite,n.render(this.quadScene,this.quadCam),n.autoClear=a}dispose(){for(const t of[this.scene,this.a,this.b,this.c,this.d])t.dispose();this.blur.dispose(),this.composite.dispose(),this.quad.geometry.dispose()}}function HM(r,t,e){const i=new GM(r,e),n=r.render.bind(r);let s=!1;return r.render=(a,o)=>{if(n(a,o),!(s||a!==t||!i.enabled||r.getRenderTarget()!==null)){s=!0;try{i.apply(n,a,o)}finally{s=!1}}},i}const Wt=2,hr=.5,$d=Wt/hr,WM=1,Qn=1,cr=Object.freeze({player:Object.freeze({radius:.32,height:.55}),beast:Object.freeze({radius:.48,height:1.05}),great:Object.freeze({radius:.7,height:1.6})});function Ke(r,t,e=0){let i=r*374761393+t*668265263+e*1442695041|0;return i=Math.imul(i^i>>>13,1274126177),i^=i>>>16,(i>>>0)/4294967295}function Yd(r){return r*r*(3-2*r)}function ia(r,t,e=0){const i=Math.floor(r),n=Math.floor(t),s=Yd(r-i),a=Yd(t-n),o=Ke(i,n,e),l=Ke(i+1,n,e),h=Ke(i,n+1,e),c=Ke(i+1,n+1,e);return o+(l-o)*s+(h-o)*a+(o-l-h+c)*s*a}function XM(r,t,e){const i=Math.min(1,Math.max(0,(e-r)/(t-r)));return i*i*(3-2*i)}function Nc(r,t,e){const[i,n,s,a]=r.rect;return t>=i*Wt&&t<(s+1)*Wt&&e>=n*Wt&&e<(a+1)*Wt}function qM(r,t,e){const[i,n,s,a]=r.rect,o=i*Wt,l=(s+1)*Wt,h=n*Wt,c=(a+1)*Wt;let d;return r.dir==="n"?d=(c-e)/(c-h):r.dir==="s"?d=(e-h)/(c-h):r.dir==="e"?d=(t-o)/(l-o):d=(l-t)/(l-o),d=Math.min(1,Math.max(0,d)),r.from+(r.to-r.from)*d}function jl(r,t,e,i,n){for(const s of r.floor??[])!!s.sharp!==n||!Nc(s,t,e)||(s.ramp?i=qM(s,t,e):s.add!==void 0?i+=s.add:i=s.h);return i}const $M=[-2,-1,0,1,2].flatMap(r=>[-2,-1,0,1,2].map(t=>[r*.9,t*.9]));function YM(r,t,e,i=null){const n=r.floorBase??0;let s=0,a=0;for(const[l,h]of $M){const c=t+l,d=e+h;i&&!i(c,d)||(r.floor??[]).some(u=>u.sharp&&Nc(u,c,d))||(s+=jl(r,c,d,n,!1),a+=1)}const o=a?s/a:jl(r,t,e,n,!1);return jl(r,t,e,o,!0)}function ZM(r,t,e,i){let n=r.clear??3.4,s=null;for(const c of r.ceil??[])Nc(c,t,e)&&(c.ceil!==void 0?s=c.ceil:c.clear!==void 0&&(n=c.clear,s=null));const a=s??i+n,o=a-i,l=(r.ceilVar??.8)*Math.min(1,Math.max(.06,(o-.8)/2.2)),h=(ia(t*.32,e*.32,31)-.5)*2+(ia(t*.9,e*.9,37)-.5)*.6;return a+h*l}function KM(r){const{width:t,height:e,solid:i,def:n}=r,s=t*$d+1,a=e*$d+1,o=new Float32Array(s*a),l=new Float32Array(s*a),h=new Float32Array(s*a),c=(p,x)=>p<0||x<0||p>=t||x>=e||i[x*t+p]===1,d=n.water?.depth??.3,u=(p,x)=>!c(Math.floor(p/Wt),Math.floor(x/Wt));for(let p=0;p<a;p+=1)for(let x=0;x<s;x+=1){const m=x*hr,g=p*hr,v=Math.floor(m/Wt),S=Math.floor(g/Wt);let _=9,E=9,b=m,A=g;for(let D=S-3;D<=S+3;D+=1)for(let $=v-3;$<=v+3;$+=1){const Q=Math.max($*Wt-m,0,m-($+1)*Wt),st=Math.max(D*Wt-g,0,g-(D+1)*Wt),rt=Math.hypot(Q,st);c($,D)?rt<_&&(_=rt):rt<E&&(E=rt,b=Math.min(Math.max(m,$*Wt+.01),($+1)*Wt-.01),A=Math.min(Math.max(g,D*Wt+.01),(D+1)*Wt-.01))}const y=_>0?_:-E,w=(ia(m*.55,g*.55,11)-.5)*.36+(ia(m*1.4,g*1.4,13)-.5)*.16,C=XM(.12,-.7,y+w),R=E>0?b:m,I=E>0?A:g;let z=YM(n,R,I,u)+(ia(m*.7,g*.7,5)-.5)*.08;r.water&&yp(r,R,I)&&(z-=d);const G=ZM(n,R,I,z),L=z+(G-z)*.42,N=p*s+x;h[N]=C,o[N]=z+C*(L-z),l[N]=G-C*(G-L)}const f={nx:s,nz:a,F:o,C:l,K:h,width:t,height:e,cell:Wt,res:hr,level:r,waterY:n.water?.y??null};return f.stalagmites=eb(f),f.stalactites=ib(f),f}function yp(r,t,e){if(!r.water)return!1;const i=Math.floor(t/Wt),n=Math.floor(e/Wt);return i<0||n<0||i>=r.width||n>=r.height?!1:r.water[n*r.width+i]===1}function Fc(r,t,e,i,n){const s=e/hr,a=i/hr,o=Math.floor(s),l=Math.floor(a);if(o<0||l<0||o>=r.nx-1||l>=r.nz-1)return n;const h=s-o,c=a-l,d=l*r.nx+o,u=t[d],f=t[d+r.nx+1];if(h>=c){const x=t[d+1];return u+h*(x-u)+c*(f-x)}const p=t[d+r.nx];return u+c*(p-u)+h*(f-p)}function JM(r,t,e){return Fc(r,r.K,t,e,1)}function Me(r,t,e){return Fc(r,r.F,t,e,999)}function hn(r,t,e){return Fc(r,r.C,t,e,-999)}function ha(r,t,e,i,n=0){const s=Me(r,t,i),a=hn(r,t,i);return a-s>2*n&&e>s+n&&e<a-n}const QM=Array.from({length:16},(r,t)=>[Math.cos(t/16*Math.PI*2),Math.sin(t/16*Math.PI*2)]);function ko(r,t,e,i,n,s=0,a=0){if(hn(r,t,e)-i<n.height)return!0;const o=s!==0||a!==0,l=n.radius,h=l*WM;for(const[c,d]of QM){if(o&&c*s+d*a<.2)continue;const u=t+c*l,f=e+d*l;if(Me(r,u,f)-i>h||hn(r,u,f)-i<n.height)return!0}return!1}function jM(r,t){const e=(t-r.y)/r.height;return e>=1?0:r.radius*(1-Math.max(0,e))}function _p(r,t,e,i,n){const s=i+Math.min(n.height,1)*.45;let a=0,o=0,l=!1;for(const h of r.stalagmites){const c=t-h.x,d=e-h.z;if(Math.abs(c)>2||Math.abs(d)>2)continue;const u=jM(h,s)+n.radius;if(u<=n.radius)continue;const f=Math.hypot(c,d);if(f>=u)continue;l=!0;const p=(u-f)/Math.max(f,1e-6);a+=f>1e-6?c*p:u,o+=f>1e-6?d*p:0}return l?{px:a,pz:o}:null}function Zd(r,t,e,i,n){return _p(r,t,e,i,n)!==null}function Kd(r,t,e,i,n){const s=(l,h)=>{const c=Math.hypot(l,h);if(c<1e-7)return!1;const d=t.x+l,u=t.z+h,f=Me(r,d,u);return ko(r,d,u,f,n,l/c,h/c)?!1:(t.x=d,t.z=u,t.y=f,!0)};let a=s(e,i);if(!a){const l=s(e,0),h=s(0,i);a=l||h;for(let c=.5;!a&&c>.03;c/=2)a=s(e*c,i*c)}const o=_p(r,t.x,t.z,t.y,n);if(o){const l=t.x+o.px,h=t.z+o.pz,c=Math.hypot(o.px,o.pz)||1,d=Me(r,l,h);ko(r,l,h,d,n,o.px/c,o.pz/c)?a&&(t.x-=e,t.z-=i,t.y=Me(r,t.x,t.z)):(t.x=l,t.z=h,t.y=d)}return a}function tb(r,t,e){const i=r.def.rows[e]?.[t];return i!==void 0&&i!=="."&&i!=="#"&&i!=="~"}function eb(r){const{level:t}=r,e=[],i=(n,s)=>!(n<0||s<0||n>=t.width||s>=t.height||t.solid[s*t.width+n]);for(let n=1;n<t.height-1;n+=1)for(let s=1;s<t.width-1;s+=1){if(!i(s,n)||tb(t,s,n)||t.water&&t.water[n*t.width+s])continue;const a=i(s-1,n)?i(s+1,n)?0:1:-1,o=i(s,n-1)?i(s,n+1)?0:1:-1;let l,h;if(a&&o&&Ke(s,n,9)<.5)l=(s+.5)*Wt+a*.62,h=(n+.5)*Wt+o*.62;else{let u=!0;for(let f=-1;f<=1;f+=1)for(let p=-1;p<=1;p+=1)i(s+p,n+f)||(u=!1);if(!u||Ke(s,n,19)>.1)continue;l=(s+.5)*Wt+(Ke(s,n,20)-.5)*.8,h=(n+.5)*Wt+(Ke(s,n,21)-.5)*.8}const c=Me(r,l,h),d=hn(r,l,h)-c;d<1.2||e.push({x:l,z:h,y:c-.05,radius:.2+Ke(s,n,10)*.2,height:Math.min(d-.3,.6+Ke(s,n,11)*1.1),id:`stalagmite_${e.length}`})}return e}function ib(r){const{level:t}=r,e=[];for(let i=1;i<t.height-1;i+=1)for(let n=1;n<t.width-1;n+=1){if(t.solid[i*t.width+n]||Ke(n,i,41)>.32)continue;const s=(n+.5)*Wt+(Ke(n,i,42)-.5)*1.2,a=(i+.5)*Wt+(Ke(n,i,43)-.5)*1.2,o=hn(r,s,a),l=o-Me(r,s,a),h=.3+Ke(n,i,44)*1.1;l-h<1.9||e.push({x:s,z:a,y:o+.05,radius:.12+Ke(n,i,45)*.16,length:h})}return e}const nc=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];function th(r,t){const e=Math.floor(r.width*Wt/Qn)-1,i=Math.floor(r.height*Wt/Qn)-1,n=new Uint8Array(e*i),s=new Uint8Array(e*i),a=o=>(o+1)*Qn;for(let o=0;o<i;o+=1)for(let l=0;l<e;l+=1){const h=a(l),c=a(o),d=Me(r,h,c);n[o*e+l]=!ko(r,h,c,d,t)&&!Zd(r,h,c,d,t)?1:0}for(let o=0;o<i;o+=1)for(let l=0;l<e;l+=1){if(!n[o*e+l])continue;let h=0;nc.forEach(([c,d],u)=>{const f=l+c,p=o+d;if(f<0||p<0||f>=e||p>=i||!n[p*e+f])return;const x=Math.hypot(c,d),m=c/x,g=d/x,v=Math.ceil(x*Qn/.15);for(let S=1;S<=v;S+=1){const _=S/v,E=a(l)+c*Qn*_,b=a(o)+d*Qn*_,A=Me(r,E,b);if(ko(r,E,b,A,t,m,g)||Zd(r,E,b,A,t))return}h|=1<<u}),s[o*e+l]=h}return{w:e,h:i,walk:n,edges:s,step:Qn,agent:t}}function Jd(r,t,e){const i=Math.round(t/r.step)-1,n=Math.round(e/r.step)-1;if(i>=0&&n>=0&&i<r.w&&n<r.h&&r.walk[n*r.w+i])return n*r.w+i;let s=-1,a=1/0;for(let o=-2;o<=2;o+=1)for(let l=-2;l<=2;l+=1){const h=i+l,c=n+o;if(h<0||c<0||h>=r.w||c>=r.h||!r.walk[c*r.w+h])continue;const d=Math.hypot((h+1)*r.step-t,(c+1)*r.step-e);d<a&&(a=d,s=c*r.w+h)}return s}function nb(r,t){const e=t%r.w;return{x:(e+1)*r.step,z:((t-e)/r.w+1)*r.step}}function sb(r,t,e=-1,i=1/0){const n=new Int32Array(r.w*r.h).fill(-2);if(t<0)return n;n[t]=-1;const s=new Int32Array(r.w*r.h);let a=0,o=0;for(s[o++]=t;a<o&&a<i;){const l=s[a++];if(l===e)break;const h=r.edges[l],c=l%r.w,d=(l-c)/r.w;for(let u=0;u<8;u+=1){if(!(h&1<<u))continue;const f=(d+nc[u][1])*r.w+c+nc[u][0];n[f]===-2&&(n[f]=l,s[o++]=f)}}return n}function Ao(r,t,e,i=1/0){const n=Jd(r,t.x,t.z),s=Jd(r,e.x,e.z);if(n<0||s<0)return null;const a=sb(r,n,s,i);if(a[s]===-2)return null;const o=[];for(let l=s;l!==n&&l!==-1;l=a[l])o.push(nb(r,l));return o.reverse()}const rb=.55,Qd=.42,jd=68,tf=.32,ab=.28,eh=3.5,ob=.12,lb=-.34,hb=-.3,cb=1.3,ef=.6,co=.14,ub=.18,nf=2*Math.PI/180,db=4,sf=.25,ih=new Z,rf=new Z;class fb{constructor(t,{reducedMotion:e=!1}={}){this.camera=t,this.yaw=0,this.pitch=-.3,this.mode="third",this.boomLength=3.4,this.boom=this.boomLength,this.shake=0,this.reducedMotion=e,this.baseFov=jd,this.kickT=99,this.roll=0,this.lastYaw=0,this.fade=1,this.follow=null,this.vel={x:0,y:0,z:0},this.reach=1,this.reachSm=1,this.frameShift=!0,t.near=.05,t.far=140,t.fov=jd,t.updateProjectionMatrix()}look(t,e){this.yaw+=t,this.yaw=Math.atan2(Math.sin(this.yaw),Math.cos(this.yaw)),this.pitch=Math.max(-1.25,Math.min(.55,this.pitch+e))}toggleMode(){return this.mode=this.mode==="third"?"first":"third",this.mode}snap(t){this.yaw=t,this.lastYaw=t,this.pitch=-.3,this.boom=.6,this.reachSm=.2,this.follow=null,this.roll=0}addShake(t){this.reducedMotion||(this.shake=Math.max(this.shake,t))}kick(t=1){!this.reducedMotion&&t>=.6&&(this.kickT=0)}forward(){const t=Math.cos(this.pitch);return{x:-Math.sin(this.yaw)*t,y:Math.sin(this.pitch),z:-Math.cos(this.yaw)*t}}castBoom(t,e,i,n){const s=i.x/n,a=i.y/n,o=i.z/n;let l=0,h=1,c=0;Math.abs(a)>.95&&(l=1,h=0);let d=a*c-o*h,u=o*l-s*c,f=s*h-a*l;const p=Math.hypot(d,u,f);d/=p,u/=p,f/=p;const x=a*f-o*u,m=o*d-s*f,g=s*u-a*d,v=[[0,0],[co,0],[-co,0],[0,co],[0,-co]];let S=n;for(const[_,E]of v)for(let b=.15;b<=n;b+=.08){const A=b/n,y=e.x+s*b+(d*_+x*E)*A,w=e.y+a*b+(u*_+m*E)*A,C=e.z+o*b+(f*_+g*E)*A;if(!ha(t,y,w,C,.09)){S=Math.min(S,Math.max(0,b-.1));break}}return S/n}update(t,e,i){const n=this.camera,s=this.forward();this.shake=Math.max(0,this.shake-t);const a=this.shake*.25,o=a?(Math.random()-.5)*a:0,l=a?(Math.random()-.5)*a:0;this.kickT+=t;const h=this.kickT<sf?Math.sin(this.kickT/sf*Math.PI):0,c=this.baseFov+db*h,d=Math.abs(n.fov-c)>.001;if(n.fov=c,this.mode==="first"){n.view?.enabled&&n.clearViewOffset(),d&&n.updateProjectionMatrix(),this.fade=1,this.roll=0;const at=e.x-Math.sin(this.yaw)*.12,bt=e.z-Math.cos(this.yaw)*.12;n.position.set(at+o,e.y+Qd+l,bt),n.lookAt(at+s.x,e.y+Qd+s.y,bt+s.z);return}const u={x:e.x,y:e.y+rb,z:e.z};(!this.follow||Math.hypot(u.x-this.follow.x,u.z-this.follow.z)>6)&&(this.follow={...u},this.vel={x:0,y:0,z:0});const f=2/ob,p=f*t,x=1/(1+p+.48*p*p+.235*p*p*p);for(const at of["x","y","z"]){const bt=this.follow[at]-u[at],_t=(this.vel[at]+f*bt)*t;this.vel[at]=(this.vel[at]-f*_t)*x,this.follow[at]=u[at]+(bt+_t)*x}const m=Math.cos(this.yaw),g=-Math.sin(this.yaw),v=this.boomLength,S={x:-s.x*v+m*tf,y:-s.y*v+ab,z:-s.z*v+g*tf};S.y=Math.min(S.y,Math.max(-.2,hn(i,u.x,u.z)-u.y-.14));const _=Math.hypot(S.x,S.y,S.z),E=Math.max(ub/_,this.castBoom(i,u,S,_));this.reach=E,this.reachSm=E<this.reachSm?E:this.reachSm+(E-this.reachSm)*(1-Math.exp(-t*1.4));const b=this.reachSm;this.boom=b*_;const A=this.follow.x+S.x*b+o,y=this.follow.y+S.y*b+l,w=this.follow.z+S.z*b;let C=A,R=y,I=w;ha(i,C,R,I,.08)||(C=u.x+S.x*b,R=u.y+S.y*b,I=u.z+S.z*b),n.position.set(C,R,I);const z=-Math.sin(this.yaw),G=-Math.cos(this.yaw);rf.set(this.follow.x+z*eh,this.follow.y-.35+Math.sin(this.pitch)*eh*.5,this.follow.z+G*eh),n.up.set(0,1,0),n.lookAt(rf);let L=this.yaw-this.lastYaw;L=Math.atan2(Math.sin(L),Math.cos(L)),this.lastYaw=this.yaw;const N=t>0?L/t:0,D=this.reducedMotion?0:Math.max(-nf,Math.min(nf,N*.012));this.roll+=(D-this.roll)*(1-Math.exp(-t*6)),Math.abs(this.roll)>1e-5&&n.rotateZ(this.roll),n.updateMatrixWorld(!0),n.view?.enabled&&n.clearViewOffset(),n.updateProjectionMatrix(),ih.set(this.follow.x,e.y+.3,this.follow.z).project(n);const $=1e3,Q=Math.max(1,Math.round($/(n.aspect||1))),st=Math.max(-.6,Math.min(.6,ih.x-lb))/2*$,rt=Math.max(-.6,Math.min(.6,hb-ih.y))/2*Q;n.setViewOffset($,Q,st,rt,$,Q);const U=Math.hypot(C-u.x,R-u.y,I-u.z);this.fade=Math.max(0,Math.min(1,(U-ef)/(cb-ef)))}getState(){return{mode:this.mode,yaw:this.yaw,pitch:this.pitch,boom:this.boom,fade:this.fade,fov:this.camera.fov,roll:this.roll}}}class af{constructor(t,{touch:e=!1}={}){this.def=t,this.touch=e,this.reset()}reset(){this.shown=new Set,this.events=new Set,this.queue=[]}textOf(t){const e=this.touch?t.touch:t.keys;return e===void 0?t.text??null:e}onEvent(t){this.events.add(t)}update(t,e){const i=[],n=t.player;for(const s of this.def.hints??[]){if(this.shown.has(s.id))continue;if(s.skipIf&&this.events.has(s.skipIf)){this.shown.add(s.id);continue}const a=s.when;let o=!1;if(a.start!==void 0?o=t.runTime>=a.start:a.moved!==void 0?o=Math.hypot(n.x-e.x,n.z-e.z)>=a.moved:a.near?o=Math.hypot(n.x-(a.near[0]+.5)*Wt,n.z-(a.near[1]+.5)*Wt)<=a.radius:a.beastNear!==void 0?o=t.beasts.some(h=>h.kind==="sleeper"&&!h.awake&&Math.hypot(h.x-n.x,h.z-n.z)<=a.beastNear):a.listenerNear!==void 0?o=t.beasts.some(h=>h.kind==="listener"&&Math.hypot(h.x-n.x,h.z-n.z)<=a.listenerNear):a.event&&(o=this.events.has(a.event)),!o)continue;this.shown.add(s.id);const l=this.textOf(s);l&&i.push({id:s.id,text:l})}return i}}const Ys="keys",Zs="touch",de=[{id:"hollow",name:"The Hollow",blurb:"Where you woke. Learn to listen.",clear:3.6,ceilVar:.9,par:{time:170,pulses:40},rows:["################################################","####.....#######################....############","###...M...######.......#######.......###########","###.......####....B.....#####....M....##########","####..##..###...........####.....##...##########","#####.##..##.....###.....##.....####..##########","#####.....#....C.###...........#####..##########","######...##.......#....######..####...##########","#######.###..##........#######.......###########","#######.###..####...##########...#.....#########","######...#..######.###########..###..B..########","##e......#.#######.##########..####......#######","#...##.....######...########..#####..##..#######","#.M.##.B...#####.....######..######..##...######","#...........####..S..#####..#######.......######","##..####....####.....####..#######...####..#####","###.####..#######...####..#######..c.####..#####","###......########...###..#######...########.####","####....#########...##..#######..##########.####","#######.########.....#..######..###########.####","#######..######...##.......###.####...#####.####","########..####...####.......#..###..M..###..####","#########..##...######.......#.##........#..####","##########.....#######..##...C...#..##..B...####","###########...#########.##...##.....##.......###","#############.##########....####...####...E..###","#############.M..############.....#####......###","##################..........................####","################################################"],floor:[{rect:[3,5,9,5],h:.3,sharp:!0},{rect:[3,4,9,4],h:.6,sharp:!0},{rect:[3,1,9,3],h:.9,sharp:!0},{rect:[34,22,40,22],ramp:!0,dir:"n",from:0,to:1.1},{rect:[35,20,38,21],h:1.1},{rect:[17,17,19,19],ramp:!0,dir:"s",from:0,to:-.9},{rect:[10,20,28,27],h:-.9},{rect:[29,21,33,27],ramp:!0,dir:"e",from:-.9,to:0}],ceil:[{rect:[14,11,22,17],clear:7},{rect:[11,1,25,9],clear:5.5},{rect:[16,4,19,6],ceil:3},{rect:[7,7,7,9],clear:.8}],hints:[{id:"move",when:{start:.6},[Ys]:"WASD to move  ·  mouse to look (click to capture it)",[Zs]:"Drag on the left to move  ·  drag on the right to look"},{id:"tap",when:{moved:3},skipIf:"pulse",[Ys]:"Tap Space or click: a quiet pulse (4 m)",[Zs]:"Tap on the right: a quiet pulse (4 m)"},{id:"hold",when:{near:[15,7],radius:7},[Ys]:"Hold Space or the mouse: a loud pulse sees 25 m - and wakes beasts",[Zs]:"Hold on the right: a loud pulse sees 25 m - and wakes beasts"},{id:"steps",when:{near:[6,6],radius:4},text:"Low ledges: just walk up them"},{id:"crawl",when:{near:[7,8],radius:4},text:"A crawlway. You fit. The beasts do not."},{id:"beast",when:{beastNear:9},text:"A beast sleeps close by. Quiet pulses only."},{id:"checkpoint",when:{event:"checkpoint"},text:"Crystal lit: you will wake here if caught"},{id:"exit",when:{event:"exitOpened"},text:"The way out is open. Follow its light."},{id:"view",when:{start:40},[Ys]:"V switches to first person",[Zs]:null}]},{id:"drowned",name:"Drowned Galleries",blurb:"Water carries your call - and every splash.",clear:4.2,ceilVar:1.1,water:{depth:.32},par:{time:200,pulses:40},rows:["############################################","#####.....#######################.....######","####..M....####~~~~~~~#######....~~~~..#####","###...........~~~~~~~~~~~####...~~~~~~~..###","###..####.....~~~~M~~~~~~~~...B.~~~~~~~..###","###..####..C..~~~~~~~~~~~~~~....~~~~M~~..###","##....###.....~~~~~~~~####~~....~~~~~~~..###","##.S..####..########~~####~~~#####~~~~#..###","##....####..########~~####~~~#####~~###..###","###..#####..###.....~~.....~~~~~~~~~~##..###","###..#####..##...B..~~..c..~~~~~~~~~~##..###","###..##.........#####~~#####~~~###~~~##..###","###.....~~~~~...#####~~#####~~~###~~~....###","####...~~~~~~~..###...B...###~~~###~~~##.###","####..~~~M~~~~..###.......###~~~...~~~##.###","#####..~~~~~~...###.......###~~~...~~~##.###","#####...~~~....####...C...####~~~~~~~~##.###","######.......######.......#####~~~~~###e####","#######..##########~~~~~~~######~~~~##..####","#######..##########~~~~~~~#######~~~#..#####","######....########~~~~M~~~~######~~~..B.####","#####......#######~~~~~~~~~~~~~~~~~~.....###","#####..B...######~~~~~~~~~~~~~~~~~~~..E..###","######.....######~~~~~~~~~~~~~~~~~~~.....###","############################################"],floor:[{rect:[1,5,5,8],h:.35},{rect:[3,9,4,10],ramp:!0,dir:"n",from:0,to:.35},{rect:[36,19,41,23],h:.4},{rect:[36,18,40,18],ramp:!0,dir:"s",from:0,to:.4}],ceil:[{rect:[14,2,28,8],clear:7.5},{rect:[17,18,36,23],clear:6},{rect:[6,11,8,12],clear:.9}],hints:[{id:"water",when:{event:"enterWater"},[Ys]:"Water carries pulses farther but blurs them. Wading is loud: hold Shift to wade slowly.",[Zs]:"Water carries pulses farther but blurs them. Wading is loud: push the stick gently to wade slowly."},{id:"alert",when:{event:"beastAlert"},text:"Something shifts in its sleep. Get out of the water."},{id:"exit",when:{event:"exitOpened"},text:"The way out is open."}]},{id:"crystal",name:"Crystal Veins",blurb:"The rock sings back. Something else listens.",clear:3.8,ceilVar:.9,par:{time:220,pulses:45},rows:["##############################################","##.....#############.M.....##########.....####","#.......*#########....*.....########...M...###","#.......##....*###.........L..######.......###","##..S...##.....###....###.......##....*....###","###...C.##.....###...#####.......*...###..####","####..####..L..###..#######..........###..####","####..####.....###..########...###..####..####","####...*........*...#########..###..####..####","#####.....##############.....*.###..###...####","######...###############..B.......###.....####","#######.################.....###.....c..######","######..########.....###########.....#########","#####..*#######...M...#########...*...########","####...########..*.*..########...........#####","####...#######.......#####.........###...#####","####...######.........####..*.M#######..######","#####L..####...C...e..####.....#######..######","######.......................*.....###..######","######...###########.......########....*######","########...........*####.###########...#######","#####################..M.###########.E.#######","##############################################"],floor:[{rect:[10,2,16,8],h:.8},{rect:[8,8,9,8],ramp:!0,dir:"e",from:0,to:.8},{rect:[14,12,22,17],h:-.6},{rect:[13,18,22,18],ramp:!0,dir:"n",from:0,to:-.6},{rect:[37,1,44,4],h:1.2},{rect:[37,5,42,6],ramp:!0,dir:"n",from:0,to:1.2}],ceil:[{rect:[16,1,33,7],clear:6.5},{rect:[26,13,41,18],clear:5},{rect:[7,9,8,11],clear:.85}],hints:[{id:"crystal",when:{near:[8,2],radius:6},text:"A crystal. Pulse near it and it answers, lighting what you cannot reach. Beasts hear it too."},{id:"listener",when:{listenerNear:11},[Ys]:"This one hears footsteps. Hold Shift to sneak.",[Zs]:"This one hears footsteps. Push the stick gently to sneak."},{id:"exit",when:{event:"exitOpened"},text:"The way out is open."}]},{id:"throat",name:"The Throat",blurb:"Down for the last light. Then up, fast.",clear:3.4,ceilVar:.7,chase:!0,par:{time:230,pulses:45},rows:["################################","########.......E.......#########","########...............#########","#########......S......##########","############.......#############","#############.....##############","###................c.......M####","###......................B..####","###...##########################","###...##########################","###...##########################","###..........................###","###....M.............C.......###","#########################...####","#########################...####","#########################...####","###....B.....c...............###","###...................M.....####","###...##########################","###...##########################","#e#...##########################","#.#..........C..............M###","#....................B......####","##########################...###","###########............##....###","##########..............#....###","#########.G......M...........###","##########..................####","###########...............######","################################"],floor:[{rect:[0,0,31,5],h:22},{rect:[0,6,31,7],h:22},{rect:[3,6,15,7],ramp:!0,dir:"e",from:17,to:22},{rect:[3,8,5,10],ramp:!0,dir:"n",from:14,to:17},{rect:[0,11,31,12],ramp:!0,dir:"w",from:10,to:14},{rect:[25,13,27,15],ramp:!0,dir:"n",from:7,to:10},{rect:[0,16,31,17],ramp:!0,dir:"e",from:4,to:7},{rect:[3,18,5,20],ramp:!0,dir:"n",from:1.5,to:4},{rect:[0,21,31,22],ramp:!0,dir:"w",from:0,to:1.5},{rect:[0,23,31,29],h:0}],ceil:[{rect:[7,1,23,5],clear:6},{rect:[9,24,30,28],clear:7.5}],hints:[{id:"throat",when:{start:.8},text:"You start just under the surface. Go down for the moths. The last one wakes the Throat: then climb."},{id:"chase",when:{event:"greatWake"},text:"It is awake. Climb. Do not stop."}]}];function pb(r){return de.find(t=>t.id===r)??de[0]}const vp="echoes-below:progress:v1",mb={easy:1.25,normal:1,hard:.9};function uo(){return{v:1,difficulty:"normal",unlocked:1,records:{}}}function Mp(){try{return globalThis.localStorage??null}catch{return null}}function gb(){try{const r=Mp()?.getItem(vp);if(!r)return uo();const t=JSON.parse(r);return!t||t.v!==1?uo():{...uo(),...t,unlocked:Math.min(de.length,Math.max(1,Number(t.unlocked)||1)),records:t.records&&typeof t.records=="object"?t.records:{}}}catch{return uo()}}function of(r){try{return Mp()?.setItem(vp,JSON.stringify(r)),!0}catch{return!1}}function bp(r,t){const e=mb[t]??1;return{time:Math.round(r.par.time*e),pulses:Math.round(r.par.pulses*e)}}function Sp(r,t){const e=bp(r,t.difficulty),i={time:t.time<=e.time,pulses:t.pulses<=e.pulses,uncaught:t.deaths===0},n=Object.values(i).filter(Boolean).length;return{stars:n===3?3:n>=2?2:1,checks:i,par:e}}function xb(r,t,e){const{stars:i}=Sp(t,e),n=r.records[t.id]??{},s=n[e.difficulty]??null,a={completed:!0,bestTime:s?.bestTime!=null?Math.min(s.bestTime,e.time):e.time,fewestPulses:s?.fewestPulses!=null?Math.min(s.fewestPulses,e.pulses):e.pulses,stars:Math.max(s?.stars??0,i)},o=de.findIndex(c=>c.id===t.id),l=Math.min(de.length,Math.max(r.unlocked,o+2));return{progress:{...r,unlocked:l,records:{...r.records,[t.id]:{...n,[e.difficulty]:a}}},record:a,stars:i,isBestTime:!s||e.time<s.bestTime,isFewestPulses:!s||e.pulses<s.fewestPulses,unlockedNew:l>r.unlocked?de[l-1]:null}}const nr=Object.freeze({easy:Object.freeze({label:"Easy",hearing:.7,beastSpeed:.82,echoFade:3.4,checkpoints:3,awake:.6,alertDecay:.12}),normal:Object.freeze({label:"Normal",hearing:1,beastSpeed:1,echoFade:2.2,checkpoints:2,awake:1,alertDecay:.07}),hard:Object.freeze({label:"Hard",hearing:1.3,beastSpeed:1.12,echoFade:1.3,checkpoints:1,awake:1.7,alertDecay:.04})}),lf=Object.freeze(["easy","normal","hard"]);function yb(r){return nr[r]??nr.normal}const hf={C:1,c:2,e:3};function _b(r=de[0]){const t=r.rows,e=t.length,i=Math.max(...t.map(o=>o.length)),n=new Uint8Array(i*e);let s=null;const a={def:r,id:r.id,width:i,height:e,cell:Wt,solid:n,water:null,start:null,checkpoints:[],moths:[],beasts:[],crystals:[],exit:null};for(let o=0;o<e;o+=1)for(let l=0;l<i;l+=1){const h=t[o][l]??"#";n[o*i+l]=h==="#"?1:0,h==="~"&&(s??=new Uint8Array(i*e),s[o*i+l]=1);const c={col:l,row:o,x:(l+.5)*Wt,z:(o+.5)*Wt};if(h==="S")a.start=c;else if(hf[h])a.checkpoints.push({...c,tier:hf[h]});else if(h==="M")a.moths.push({...c,id:`moth_${a.moths.length+1}`});else if(h==="B"||h==="L"||h==="G"){const d=h==="B"?"sleeper":h==="L"?"listener":"great";a.beasts.push({...c,kind:d,id:`${d==="great"?"great":"beast"}_${a.beasts.length+1}`})}else h==="*"?a.crystals.push({...c,id:`crystal_${a.crystals.length+1}`}):h==="E"&&(a.exit=c)}return a.water=s,a}const nh=new Map;function vb(r=de[0]){if(nh.has(r))return nh.get(r);const t=_b(r),e=KM(t);t.terrain=e;for(const i of[[t.start],t.checkpoints,t.moths,t.beasts,t.crystals,[t.exit]])for(const n of i)n.y=Me(e,n.x,n.z);for(const i of t.crystals)e.stalagmites.push({x:i.x,z:i.z,y:i.y-.05,radius:.42,height:2.2,crystal:!0,id:i.id});return t.nav={player:th(e,cr.player)},t.beasts.some(i=>i.kind!=="great")&&(t.nav.beast=th(e,cr.beast)),t.beasts.some(i=>i.kind==="great")&&(t.nav.great=th(e,cr.great)),nh.set(r,t),t}const Co=Object.freeze({playerSpeed:3.6,sneakFactor:.42,fastPace:.62,waterSpeed:.8,tapRadius:4,fullRadius:25,waterPulseScale:1.4,tapThreshold:.18,chargeTime:.9,pulseCooldown:.3,pulseSpeed:22,pulseHeight:.4,maxPulses:12,beastSpeed:3.1,beastLungeSpeed:3.9,beastRouse:.7,returnPace:.6,beastSearch:3,beastSenseRadius:2.4,giveUp:8,catchRadius:.85,greatCatchRadius:1.3,greatSpeed:3.05,greatRouse:1.4,greatRepath:.4,greatRespawnBehind:11,mothRadius:1.1,checkpointRadius:1.6,exitRadius:1.8,reachHeight:1.4,crystalRadius:11,crystalLoudness:.35,crystalCooldown:2,footstepRadius:7.5,footstepRate:1.8,awakeHearing:.7,wadeRadius:8,wadeRate:.24,wadeSneakRadius:4,wadeSneakRate:.07,stride:.55,muffled:.5,softPulseRadius:10}),Ht=Object.freeze({TITLE:"title",PLAYING:"playing",PAUSED:"paused",CAUGHT:"caught",WON:"won"}),Yt=Object.freeze({SLEEPING:"sleeping",DORMANT:"dormant",ROUSING:"rousing",HUNTING:"hunting",SEARCHING:"searching",RETURNING:"returning",LUNGING:"lunging",CHASING:"chasing"}),Hr=(r,t)=>Math.hypot(r.x-t.x,(r.y??0)-(t.y??0),r.z-t.z);class Mb{constructor({level:t=de[0],difficulty:e="normal",tuning:i}={}){this.tuning={...Co,...i??{}},this.listeners=new Map,this.clock=0,this.phase=Ht.TITLE,this.setLevel(t,e)}on(t,e){return this.listeners.has(t)||this.listeners.set(t,new Set),this.listeners.get(t).add(e),()=>this.listeners.get(t)?.delete(e)}emit(t,e={}){for(const i of this.listeners.get(t)??[])i(e);for(const i of this.listeners.get("*")??[])i(t,e)}setLevel(t=this.def,e=this.difficultyId){this.def=typeof t=="string"?de.find(i=>i.id===t)??de[0]:t,this.difficultyId=e in{easy:1,normal:1,hard:1}?e:"normal",this.diff=yb(this.difficultyId),this.level=vb(this.def),this.terrain=this.level.terrain,this.echoFade=this.diff.echoFade,this.phase=Ht.TITLE,this.resetRun()}resetRun(){const{level:t}=this,e=t.start;this.player={x:e.x,y:e.y,z:e.z,facing:this.headingFrom(e),speed:0,pace:0,sneaking:!1},this.inWater=!1,this.strideLeft=this.tuning.stride,this.checkpointIndex=0;const i=this.diff.checkpoints;this.checkpoints=[{id:"cp_0",x:e.x,y:e.y,z:e.z,active:!0,start:!0},...t.checkpoints.filter(n=>n.tier<=i).map((n,s)=>({id:`cp_${s+1}`,x:n.x,y:n.y,z:n.z,active:!1}))],this.moths=t.moths.map(n=>({...n,collected:!1})),this.crystals=t.crystals.map(n=>({id:n.id,x:n.x,y:n.y,z:n.z,cooldownUntil:-1,lastEcho:-99})),this.beasts=t.beasts.map(n=>this.#e(n)),this.pendingEchoes=[],this.exitOpen=!1,this.chase=!1,this.pulses=[],this.charge=null,this.cooldown=0,this.runTime=0,this.noise=0,this.stats={tapPulses:0,fullPulses:0,deaths:0},this.lastPulse=null,this.result=null}#e(t){const e=t.kind==="great";return{id:t.id,kind:t.kind,homeX:t.x,homeZ:t.z,x:t.x,y:t.y,z:t.z,state:e?Yt.DORMANT:Yt.SLEEPING,timer:0,target:null,path:[],facing:0,alert:0,alerted:!1,speed:0,stuck:0,repath:0}}#i(t){if(this.phase===t)return;const e=this.phase;this.phase=t,this.emit("phase",{from:e,to:t})}start(){return this.phase!==Ht.TITLE&&this.phase!==Ht.WON?!1:(this.resetRun(),this.#i(Ht.PLAYING),this.emit("start",{level:this.def.id,difficulty:this.difficultyId}),this.softPulse(),!0)}restart(){return this.phase=Ht.TITLE,this.start()}pause(){return this.phase!==Ht.PLAYING?!1:(this.charge=null,this.#i(Ht.PAUSED),!0)}resume(){return this.phase!==Ht.PAUSED?!1:(this.#i(Ht.PLAYING),!0)}togglePause(){return this.phase===Ht.PAUSED?this.resume():this.pause()}headingFrom(t){const{level:e}=this,i=e.moths.map(s=>Ao(e.nav.player,t,s)).filter(Boolean).sort((s,a)=>s.length-a.length)[0],n=i?.[Math.min(4,i.length-1)];return n?Math.atan2(-(n.x-t.x),-(n.z-t.z)):0}respawn(){if(this.phase!==Ht.CAUGHT)return!1;const t=this.checkpoints[this.checkpointIndex];return Object.assign(this.player,{x:t.x,y:t.y,z:t.z,speed:0,pace:0,facing:this.headingFrom(t)}),this.beasts=this.level.beasts.map(e=>this.#e(e)),this.chase&&this.#l(t),this.pendingEchoes=[],this.charge=null,this.cooldown=0,this.#i(Ht.PLAYING),this.emit("respawn",{checkpoint:t.id,x:t.x,y:t.y,z:t.z,yaw:this.player.facing}),this.softPulse(),!0}beginCharge(){return this.phase!==Ht.PLAYING||this.charge!==null?!1:(this.charge=0,this.emit("chargeStart",{}),!0)}cancelCharge(){return this.charge===null?!1:(this.charge=null,this.emit("chargeCancel",{}),!0)}releasePulse(){if(this.phase!==Ht.PLAYING||this.charge===null)return null;const t=this.charge;return this.charge=null,this.cooldown>0?(this.emit("pulseBlocked",{}),null):this.emitPulse(this.chargeRadius(t))}chargeRadius(t=this.charge??0){const{tapRadius:e,fullRadius:i,tapThreshold:n,chargeTime:s}=this.tuning,a=Math.min(1,Math.max(0,(t-n)/s));return e+(i-e)*a}emitPulse(t){const{tapRadius:e,fullRadius:i,pulseCooldown:n,waterPulseScale:s,pulseHeight:a}=this.tuning,o=Math.min(i,Math.max(e,t)),l=o<=e+.01?"tap":o>=i-.01?"full":"mid",h=this.inWater,c=this.player,d=this.#s({x:c.x,y:c.y+a,z:c.z,radius:h?o*s:o,kind:l,wet:h,source:"player"});return l==="tap"?this.stats.tapPulses+=1:this.stats.fullPulses+=1,this.cooldown=n,this.lastPulse=d,this.emit("pulse",{...d,loudness:o/i}),this.#n(d,1),d}softPulse(t=this.tuning.softPulseRadius){if(this.phase!==Ht.PLAYING)return null;const e=this.player,i=this.#s({x:e.x,y:e.y+this.tuning.pulseHeight,z:e.z,radius:t,kind:"soft",wet:!1,source:"auto"},{silent:!0});return this.emit("softPulse",{...i}),i}#s(t,{silent:e=!1}={}){const i={...t,time:this.clock};if(this.pulses.push(i),this.pulses.length>this.tuning.maxPulses&&this.pulses.shift(),e)return i;for(const n of this.crystals){if(n.id===t.source||this.pendingEchoes.some(a=>a.crystal===n))continue;const s=Hr(i,{x:n.x,y:n.y+.8,z:n.z});s>i.radius||this.pendingEchoes.push({crystal:n,at:i.time+s/this.tuning.pulseSpeed})}return i}#n(t,e){const i=t.radius*this.diff.hearing*e;for(const n of this.beasts){if(n.state===Yt.DORMANT||n.state===Yt.CHASING)continue;const s=Hr(n,t);s>i||s>i*this.tuning.muffled&&!this.#a(t,{x:n.x,y:n.y+.7,z:n.z})||this.#o(n,{x:t.x,z:t.z},t.source==="player"?"pulse":"crystal",s)}}#a(t,e){const i=Hr(t,e),n=Math.ceil(i/.5);for(let s=1;s<n;s+=1){const a=s/n;if(!ha(this.terrain,t.x+(e.x-t.x)*a,t.y+(e.y-t.y)*a,t.z+(e.z-t.z)*a,.02))return!1}return!0}#o(t,e,i,n=0){t.target={x:e.x,z:e.z},t.path=this.#r(t,t.target),t.stuck=0,t.alert=0,t.state===Yt.SLEEPING?(t.state=Yt.ROUSING,t.timer=this.tuning.beastRouse,this.emit("beastWake",{id:t.id,kind:t.kind,x:t.x,y:t.y,z:t.z,distance:n,cause:i})):t.state!==Yt.ROUSING&&t.state!==Yt.LUNGING&&(t.state=Yt.HUNTING,this.emit("beastHunt",{id:t.id,x:t.x,y:t.y,z:t.z,cause:i}))}#t(t){return t.kind==="great"?this.level.nav.great:this.level.nav.beast}#r(t,e){const i=this.#t(t);return(i&&Ao(i,t,e,6e3))??[]}#u(t){return t.kind==="great"?cr.great:cr.beast}#l(t){const e=this.beasts.find(o=>o.kind==="great");if(!e)return;const i=this.level.nav.great,n=Ao(i,t,{x:e.homeX,z:e.homeZ})??[];let s=0,a=n[n.length-1]??{x:e.homeX,z:e.homeZ};for(let o=1;o<n.length;o+=1)if(s+=Math.hypot(n[o].x-n[o-1].x,n[o].z-n[o-1].z),s>=this.tuning.greatRespawnBehind){a=n[o];break}e.x=a.x,e.z=a.z,e.y=Me(this.terrain,a.x,a.z),e.state=Yt.ROUSING,e.timer=this.tuning.greatRouse+.4,e.path=[]}update(t,e={}){this.clock+=t;const i=this.tuning.fullRadius*this.tuning.waterPulseScale/this.tuning.pulseSpeed+this.echoFade+8*(this.echoFade/2.2)+.2;this.pulses=this.pulses.filter(n=>this.clock-n.time<i),this.phase===Ht.PLAYING&&(this.runTime+=t,this.cooldown=Math.max(0,this.cooldown-t),this.charge!==null&&(this.charge+=t),this.#h(t,e),this.#d(),this.#f(t),this.phase===Ht.PLAYING&&this.#v())}#h(t,e){const i=this.tuning,n=Number(e.moveX)||0,s=Number(e.moveY)||0,a=Number(e.yaw)||0;let o=Math.hypot(n,s);const l=-Math.sin(a),h=-Math.cos(a),c=Math.cos(a),d=-Math.sin(a);let u=l*s+c*n,f=h*s+d*n;o>1&&(u/=o,f/=o,o=1);const p=this.player;p.sneaking=!!e.sneak;const x=o*(p.sneaking?i.sneakFactor:1),m=i.playerSpeed*x*(this.charge!==null?.6:1)*(this.inWater?i.waterSpeed:1),g=p.x,v=p.z;o>.01&&(p.facing=Math.atan2(-u,-f),Kd(this.terrain,p,u/o*m*t,f/o*m*t,cr.player));const S=Math.hypot(p.x-g,p.z-v);p.speed=S/t,p.pace=S>1e-4?x:0;const _=this.inWater;this.inWater=yp(this.level,p.x,p.z),this.inWater&&!_&&this.emit("enterWater",{x:p.x,z:p.z});const E=p.pace>i.fastPace;this.noise=S>1e-4?this.inWater?E?1:.4:E?.55:.1:0,S>1e-4&&(this.strideLeft-=S,this.strideLeft<=0&&(this.strideLeft+=i.stride*(E?1:1.3),this.emit("step",{x:p.x,y:p.y,z:p.z,water:this.inWater,pace:p.pace})),E&&this.#c("footsteps",i.footstepRadius,i.footstepRate,t,b=>b.kind==="listener"),this.inWater&&this.#c("wading",E?i.wadeRadius:i.wadeSneakRadius,E?i.wadeRate:i.wadeSneakRate,t,()=>!0));for(const b of this.beasts)b.heardAt===this.clock||b.state!==Yt.SLEEPING||(b.alert=Math.max(0,b.alert-this.diff.alertDecay*t),b.alert<.3&&(b.alerted=!1))}#c(t,e,i,n,s){const a=this.player,o=e*this.diff.hearing;for(const l of this.beasts){if(!s(l)||l.kind==="great")continue;const h=Hr(l,a);h>o||(l.state===Yt.SLEEPING?(l.heardAt=this.clock,l.alert+=n*i*(1-h/o)*2,l.alert>=.5&&!l.alerted&&(l.alerted=!0,this.emit("beastAlert",{id:l.id,kind:l.kind,x:l.x,y:l.y,z:l.z,cause:t})),l.alert>=1&&this.#o(l,a,t,h)):h<o*this.tuning.awakeHearing&&(l.state===Yt.SEARCHING||l.state===Yt.RETURNING||l.state===Yt.HUNTING&&this.clock-(l.lastHeard??-9)>.6)&&(l.lastHeard=this.clock,this.#o(l,a,t,h)))}}#d(){if(!this.pendingEchoes.length)return;const t=this.pendingEchoes.filter(e=>e.at<=this.clock);if(t.length){this.pendingEchoes=this.pendingEchoes.filter(e=>e.at>this.clock);for(const{crystal:e}of t){if(e.cooldownUntil>this.clock)continue;e.cooldownUntil=this.clock+this.tuning.crystalCooldown,e.lastEcho=this.clock;const i=this.#s({x:e.x,y:e.y+.8,z:e.z,radius:this.tuning.crystalRadius,kind:"crystal",wet:!1,source:e.id});this.emit("crystalEcho",{id:e.id,x:e.x,y:e.y+.8,z:e.z,radius:i.radius}),this.#n(i,this.tuning.crystalLoudness)}}}#f(t){const e=this.tuning,i=this.player,n=e.beastSenseRadius*this.diff.hearing,s=this.diff.beastSpeed;for(const a of this.beasts){if(a.speed=0,a.state===Yt.SLEEPING||a.state===Yt.DORMANT)continue;if(a.state===Yt.ROUSING){a.timer-=t,a.timer<=0&&(a.kind==="great"?(a.state=Yt.CHASING,a.repath=0,this.emit("greatChase",{id:a.id})):a.state=Yt.HUNTING);continue}if(a.kind==="great")this.#y(a,t,e.greatSpeed*s);else if(Hr(a,i)<n&&Math.abs(a.y-i.y)<1.6&&this.clock>=(a.giveUpUntil??-1)?(a.state!==Yt.LUNGING&&this.emit("beastLunge",{id:a.id,x:a.x,y:a.y,z:a.z}),a.state=Yt.LUNGING):a.state===Yt.LUNGING&&(a.state=Yt.SEARCHING,a.timer=e.beastSearch*this.diff.awake),a.state===Yt.LUNGING){const h=e.beastLungeSpeed*s*t;this.#m(a,i.x,i.z,h),a.stall=a.speed<h*.25?(a.stall??0)+t:0,a.stall>1.5&&(a.stall=0,a.giveUpUntil=this.clock+e.giveUp,a.state=Yt.SEARCHING,a.timer=e.beastSearch*this.diff.awake,this.emit("beastGiveUp",{id:a.id,x:a.x,y:a.y,z:a.z}))}else a.state===Yt.HUNTING?this.#p(a,t,e.beastSpeed*s,()=>{a.state=Yt.SEARCHING,a.timer=e.beastSearch*this.diff.awake}):a.state===Yt.SEARCHING?(a.timer-=t,a.facing+=t*1.5,a.timer<=0&&(Math.hypot(a.homeX-a.x,a.homeZ-a.z)>1.5?(a.state=Yt.RETURNING,a.target={x:a.homeX,z:a.homeZ},a.path=this.#r(a,a.target),a.stuck=0):this.#x(a))):a.state===Yt.RETURNING&&this.#p(a,t,e.beastSpeed*e.returnPace*s,()=>this.#x(a));const o=a.kind==="great"?e.greatCatchRadius:e.catchRadius;if(Math.hypot(i.x-a.x,i.z-a.z)<o&&Math.abs(i.y-a.y)<1.5){this.#_(a);return}}}#x(t){t.state=Yt.SLEEPING,t.target=null,t.alert=0,this.emit("beastSettle",{id:t.id,x:t.x,y:t.y,z:t.z})}#y(t,e,i){t.repath-=e,(t.repath<=0||!t.path.length)&&(t.repath=this.tuning.greatRepath,t.target={x:this.player.x,z:this.player.z},t.path=this.#r(t,t.target)),Math.hypot(this.player.x-t.x,this.player.z-t.z)<2.5?this.#m(t,this.player.x,this.player.z,i*e):this.#p(t,e,i,()=>{})}#p(t,e,i,n){const s=t.path[0];if(!s){n();return}const a=t.path.length===1,o=a&&t.target?t.target.x:s.x,l=a&&t.target?t.target.z:s.z,h=Math.hypot(o-t.x,l-t.z),c=this.#m(t,o,l,i*e);if(c<.3||a&&c<.8){t.path.shift(),t.stuck=0;return}t.stuck=h-c<i*e*.2?t.stuck+e:0,t.stuck>1.2&&(t.stuck=0,t.path=[],n())}#m(t,e,i,n){const s=e-t.x,a=i-t.z,o=Math.hypot(s,a);if(o>1e-4){const l=Math.min(1,n/o),h=t.x,c=t.z;Kd(this.terrain,t,s*l,a*l,this.#u(t)),t.speed=Math.hypot(t.x-h,t.z-c),t.facing=Math.atan2(-s,-a)}return Math.hypot(e-t.x,i-t.z)}#_(t){this.stats.deaths+=1,this.charge=null,this.#i(Ht.CAUGHT),this.emit("caught",{by:t.id,kind:t.kind,x:this.player.x,y:this.player.y,z:this.player.z})}#g(t,e){const i=this.player;return Math.hypot(t.x-i.x,t.z-i.z)<e&&Math.abs((t.y??i.y)-i.y)<this.tuning.reachHeight}#v(){const t=this.tuning,e=this.moths.length;for(const i of this.moths){if(i.collected||!this.#g(i,t.mothRadius))continue;i.collected=!0;const n=this.mothsCollected();if(this.emit("mothCollected",{id:i.id,count:n,required:e,x:i.x,y:i.y,z:i.z}),n>=e&&!this.exitOpen){this.exitOpen=!0;const s=this.level.exit;this.emit("exitOpened",{x:s.x,y:s.y,z:s.z});const a=this.beasts.find(o=>o.kind==="great");this.def.chase&&a&&(this.chase=!0,a.state=Yt.ROUSING,a.timer=t.greatRouse,this.emit("greatWake",{id:a.id,x:a.x,y:a.y,z:a.z}))}}this.checkpoints.forEach((i,n)=>{this.#g(i,t.checkpointRadius)&&(i.active?n!==this.checkpointIndex&&(this.checkpointIndex=n):(i.active=!0,this.checkpointIndex=n,this.emit("checkpoint",{id:i.id,x:i.x,y:i.y,z:i.z})))}),this.exitOpen&&this.#g(this.level.exit,t.exitRadius)&&(this.result={level:this.def.id,difficulty:this.difficultyId,time:this.runTime,pulses:this.stats.tapPulses+this.stats.fullPulses,tapPulses:this.stats.tapPulses,fullPulses:this.stats.fullPulses,deaths:this.stats.deaths},this.#i(Ht.WON),this.emit("won",this.result))}mothsCollected(){return this.moths.reduce((t,e)=>t+(e.collected?1:0),0)}getState(){const t=this.player;return{phase:this.phase,level:this.def.id,difficulty:this.difficultyId,clock:this.clock,runTime:this.runTime,player:{x:t.x,y:t.y,z:t.z,facing:t.facing,speed:t.speed,sneaking:t.sneaking,inWater:this.inWater},noise:this.noise,charging:this.charge!==null,chargeRadius:this.charge!==null?this.chargeRadius():0,cooldown:this.cooldown,mothsCollected:this.mothsCollected(),mothsRequired:this.moths.length,moths:this.moths.map(e=>({id:e.id,x:e.x,y:e.y,z:e.z,collected:e.collected})),beasts:this.beasts.map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,z:e.z,state:e.state,alert:e.alert,awake:e.state!==Yt.SLEEPING&&e.state!==Yt.DORMANT})),crystals:this.crystals.map(e=>({id:e.id,x:e.x,y:e.y,z:e.z,lastEcho:e.lastEcho})),chase:this.chase,checkpoint:this.checkpoints[this.checkpointIndex].id,checkpoints:this.checkpoints.map(e=>({id:e.id,x:e.x,y:e.y,z:e.z,active:e.active})),exit:{x:this.level.exit.x,y:this.level.exit.y,z:this.level.exit.z,open:this.exitOpen},stats:{...this.stats,pulses:this.stats.tapPulses+this.stats.fullPulses},result:this.result}}}function os(r,t=!1){const e=r[0].index!==null,i=new Set(Object.keys(r[0].attributes)),n=new Set(Object.keys(r[0].morphAttributes)),s={},a={},o=r[0].morphTargetsRelative,l=new ze;let h=0;for(let c=0;c<r.length;++c){const d=r[c];let u=0;if(e!==(d.index!==null))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."),null;for(const f in d.attributes){if(!i.has(f))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+'. All geometries must have compatible attributes; make sure "'+f+'" attribute exists among all geometries, or in none of them.'),null;s[f]===void 0&&(s[f]=[]),s[f].push(d.attributes[f]),u++}if(u!==i.size)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". Make sure all geometries have the same number of attributes."),null;if(o!==d.morphTargetsRelative)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". .morphTargetsRelative must be consistent throughout all geometries."),null;for(const f in d.morphAttributes){if(!n.has(f))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+".  .morphAttributes must be consistent throughout all geometries."),null;a[f]===void 0&&(a[f]=[]),a[f].push(d.morphAttributes[f])}if(t){let f;if(e)f=d.index.count;else if(d.attributes.position!==void 0)f=d.attributes.position.count;else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". The geometry must have either an index or a position attribute"),null;l.addGroup(h,f,c),h+=f}}if(e){let c=0;const d=[];for(let u=0;u<r.length;++u){const f=r[u].index;for(let p=0;p<f.count;++p)d.push(f.getX(p)+c);c+=r[u].attributes.position.count}l.setIndex(d)}for(const c in s){const d=cf(s[c]);if(!d)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+c+" attribute."),null;l.setAttribute(c,d)}for(const c in a){const d=a[c][0].length;if(d!==0){l.morphAttributes=l.morphAttributes||{},l.morphAttributes[c]=[];for(let u=0;u<d;++u){const f=[];for(let x=0;x<a[c].length;++x)f.push(a[c][x][u]);const p=cf(f);if(!p)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+c+" morphAttribute."),null;l.morphAttributes[c].push(p)}}}return l}function cf(r){let t,e,i,n=-1,s=0;for(let h=0;h<r.length;++h){const c=r[h];if(t===void 0&&(t=c.array.constructor),t!==c.array.constructor)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."),null;if(e===void 0&&(e=c.itemSize),e!==c.itemSize)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."),null;if(i===void 0&&(i=c.normalized),i!==c.normalized)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."),null;if(n===-1&&(n=c.gpuType),n!==c.gpuType)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."),null;s+=c.count*e}const a=new t(s),o=new ei(a,e,i);let l=0;for(let h=0;h<r.length;++h){const c=r[h];if(c.isInterleavedBufferAttribute){const d=l/e;for(let u=0,f=c.count;u<f;u++)for(let p=0;p<e;p++){const x=c.getComponent(u,p);o.setComponent(u+d,p,x)}}else a.set(c.array,l);l+=c.count*e}return n!==void 0&&(o.gpuType=n),o}const na=12,Ro=8,bb=`
  attribute vec3 bary;
  attribute vec3 crease;
  varying vec3 vWorld;
  varying vec3 vBary;
  varying vec3 vCrease;
  void main() {
    vec4 w = vec4(position, 1.0);
#ifdef USE_INSTANCING
    w = instanceMatrix * w;
#endif
    w = modelMatrix * w;
    vWorld = w.xyz;
    vBary = bary;
    vCrease = crease;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`,Sb=`
  #define MAX_PULSES ${na}
  #define MAX_LIGHTS ${Ro}
  uniform float uTime;
  uniform vec4 uPulse[MAX_PULSES];   // origin xyz, radius
  uniform vec2 uPulseB[MAX_PULSES];  // start time, wet
  uniform int uCount;
  uniform float uSpeed;
  uniform float uFade;
  uniform vec4 uLight[MAX_LIGHTS];   // position xyz, radius
  uniform vec3 uLightColor[MAX_LIGHTS];
  uniform int uLightCount;
  uniform vec3 uColor;
  uniform vec3 uFront;
  uniform vec3 uPlayer;
  uniform float uKind;     // 0 rock, 1 creature, 2 water
  uniform float uStrength;
  uniform float uGlow;     // crystals: own inner glow (flares when the crystal answers)
  varying vec3 vWorld;
  varying vec3 vBary;
  varying vec3 vCrease;

  float band(float v, float width) {
    float fw = max(fwidth(v), 1e-4);
    float d = abs(fract(v - 0.5) - 0.5);
    return 1.0 - smoothstep(fw * 0.6, fw * width, d);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 V = normalize(cameraPosition - vWorld);
    if (dot(N, V) < 0.0) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.0);

    float glow = 0.0;
    float eglow = 0.0;   // edge brightness: bright phase, then a faint lingering memory
    float front = 0.0;
    float cfront = 0.0;   // wavefront of a crystal's re-emitted pulse
    float violet = 0.0;
    float trail = 0.0;
    float blur = 0.0;
    float shapeAcc = 0.0;
    float fallAcc = 0.0;
    float echoScale = uFade / 2.2;   // difficulty: Easy lingers longer, Hard less
    float aaD = max(length(fwidth(vWorld)), 0.015);
    for (int i = 0; i < MAX_PULSES; i++) {
      if (i >= uCount) break;
      vec4 p = uPulse[i];
      float t0 = uPulseB[i].x;
      float wet = mod(uPulseB[i].y, 2.0);
      float cry = uPulseB[i].y > 1.5 ? 1.0 : 0.0;
      float age = uTime - t0;
      float wave = age * uSpeed;
      float d = distance(vWorld, p.xyz);
      if (wet > 0.5) {
        // Water: the wavefront ripples and smears.
        d += (sin(vWorld.x * 2.3 + uTime * 3.1) + sin(vWorld.z * 2.9 - uTime * 2.6) + sin((vWorld.x + vWorld.y) * 4.1 + uTime * 4.0) * 0.5) * 0.22;
      }
      if (d > p.w || d > wave + 0.35) continue;
      float rim = smoothstep(p.w, p.w * 0.72, d);
      float x = wave - d;   // metres behind the front (negative: just ahead of it)
      // Thin bright band (about 0.3 m wide, anti-aliased), a faint violet fringe ahead of it, a soft trail behind.
      float hw = wet > 0.5 ? 0.5 : 0.16;
      float core = 1.0 - smoothstep(hw - aaD, hw + aaD, abs(x));
      float fringe = x < 0.0 ? (1.0 - smoothstep(0.0, 0.3, -x)) * 0.45 : 0.0;
      if (wave < p.w + 1.5) {
        front = max(front, core * rim);
        cfront = max(cfront, cry * smoothstep(hw * 2.2 + aaD, hw * 0.4, abs(x)) * rim);
        violet = max(violet, fringe * rim);
      }
      if (x < 0.0) continue;
      trail = max(trail, pow(clamp(1.0 - x / 1.5, 0.0, 1.0), 2.0) * rim);
      float since = x / uSpeed;
      float g = clamp(1.0 - since / uFade, 0.0, 1.0);
      g *= g;
      // Memory: edges settle to about 15% of peak, then fade over ~4 s (quiet) to ~8 s (loud).
      float aft = (4.0 + 4.0 * clamp((p.w - 4.0) / 21.0, 0.0, 1.0)) * echoScale;
      float e = since < uFade ? 0.18 + 0.82 * g : 0.18 * pow(clamp(1.0 - (since - uFade) / aft, 0.0, 1.0), 1.5);
      if (wet > 0.5) { g *= 0.7 + 0.3 * sin(d * 5.0 - uTime * 6.0); blur = max(blur, g * rim); }
      eglow = max(eglow, e * rim);
      // Each pulse lights faces by its own direction and falloff, and the brightest wins per term, so
      // overlapping pulses (a crystal answering) never leave a darker shell where they cross.
      float gr = g * rim;
      if (gr > 0.0) {
        float fi = 1.0 - 0.65 * smoothstep(0.1, 1.0, d / p.w);
        float ni = max(dot(N, normalize(p.xyz - vWorld)), 0.0);
        shapeAcc = max(shapeAcc, gr * (0.3 * ni + 0.5 * fres) * fi);
        fallAcc = max(fallAcc, fi);
        glow = max(glow, gr);
      }
    }
    float shapeW = shapeAcc / max(glow, 1e-3);   // face shading of the lit pulses, independent of which one is strongest
    float fall = glow > 0.0 ? fallAcc : 1.0;
    // Whisker sense: a faint touch-radius right around the creature.
    float near = distance(vWorld, uPlayer);
    glow = max(glow, 0.24 * smoothstep(2.3, 0.3, near));
    eglow = max(eglow, glow);

    vec3 light = vec3(0.0);
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uLightCount) break;
      float d = distance(vWorld, uLight[i].xyz);
      float k = clamp(1.0 - d / uLight[i].w, 0.0, 1.0);
      light += uLightColor[i] * k * k * (0.35 + 0.65 * ndv);
    }

    vec3 col;
    float alpha = 1.0;
    if (uKind > 2.5) {
      // Crystal: crisp facet edges, an inner glow that rises when a pulse passes, fresnel + slight transparency.
      vec3 L = normalize(vec3(0.35, 0.8, 0.45));
      float facet = 0.55 + 0.45 * dot(N, L);
      vec3 bwc = vBary / max(fwidth(vBary), vec3(1e-5));
      vec3 lnc = (1.0 - smoothstep(0.4, 1.3, bwc)) * smoothstep(0.05, 0.3, vCrease);
      float edgeC = clamp(max(lnc.x, max(lnc.y, lnc.z)), 0.0, 1.0);
      float inner = uGlow + 0.7 * glow + 0.5 * front + 0.3 * trail + 0.2 * eglow;
      vec3 hot = mix(uColor, vec3(1.0), 0.55);
      col = uColor * (0.2 + inner) * (0.5 + 0.6 * facet) * (0.55 + 0.7 * ndv)
          + hot * fres * (0.35 + 0.8 * inner)
          + hot * edgeC * (0.3 + 1.5 * inner)
          + uFront * front * 0.4 + light * 0.4;
      col = col / (1.0 + 0.7 * col);   // soft shoulder: a flaring crystal keeps its facets instead of blowing out
      alpha = clamp(0.62 + 0.38 * fres + 0.25 * inner + 0.4 * edgeC, 0.0, 1.0);
    } else if (uKind > 1.5) {
      // Water surface: slow ripple rings, mostly transparent (additive).
      float r = band(vWorld.x * 0.7 + sin(vWorld.z * 1.3 + uTime * 0.8) * 0.5 + sin(uTime * 0.6 + vWorld.z * 0.4), 2.4);
      float r2 = band(vWorld.z * 0.6 + sin(vWorld.x * 1.1 - uTime * 0.7) * 0.5, 2.4);
      float lines = max(r, r2);
      col = uColor * glow * (0.05 + 0.5 * lines) + uFront * front * (0.15 + 0.5 * lines) + light * 0.25;
    } else if (uKind > 0.5) {
      // Creatures: a strong silhouette rim so the shape reads at a glance.
      col = uColor * glow * (0.12 + 1.6 * fres) + uFront * front * (0.4 + 1.2 * fres) + light * 0.5;
    } else {
      float wall = 1.0 - smoothstep(0.35, 0.75, abs(N.y));
      // Edges come from geometry: a sharp change of facet normal between neighbouring pixels.
      vec3 bw = vBary / max(fwidth(vBary), vec3(1e-5));
      vec3 sharp = smoothstep(0.05, 0.3, vCrease);
      vec3 ln = (1.0 - smoothstep(0.4, 1.4, bw)) * sharp;
      float edge = max(ln.x, max(ln.y, ln.z));
      // Shape lighting kept low: dark-to-mid faces, brighter rims, distance falloff for depth.
      // Roof: surfaces seen from below (N.y < 0) get a fuller face fill, so a pulse shows a ceiling, not just its lines.
      float roof = smoothstep(-0.2, -0.55, N.y);
      float shape = shapeW * (1.0 + 1.6 * roof);
      // Fine rock grain (about 3 and 8 cycles per metre) with small pits; no large blobs.
      float grain = vnoise(vWorld * 3.0) * 0.6 + vnoise(vWorld * 8.0) * 0.4;
      float pit = smoothstep(0.78, 0.92, vnoise(vWorld * 13.0));
      float tex = (0.85 + 0.3 * grain) * (1.0 - 0.3 * pit);
      // Soft, noise-warped strata on steep walls only: uneven spacing and thickness, faint.
      float sc = vWorld.y * 0.8 + vnoise(vec3(vWorld.x * 0.35, vWorld.y * 0.2, vWorld.z * 0.35)) * 4.0;
      float sn = vnoise(vec3(sc, vWorld.x * 0.15, vWorld.z * 0.15));
      float strata = smoothstep(0.62, 0.9, sn) * smoothstep(0.35, 0.65, vnoise(vWorld * 0.9)) * wall;
      // Floors: very faint contours broken up by noise, never a continuous line.
      float fl = (1.0 - wall) * smoothstep(0.55, 0.85, abs(N.y));
      float cw = vWorld.y * 0.9 + vnoise(vWorld * 0.5) * 2.0;
      float cont = smoothstep(0.35, 0.5, 0.5 - abs(fract(cw) - 0.5)) * smoothstep(0.55, 0.8, vnoise(vWorld * 1.3 + 7.0)) * fl;
      float lines = clamp(edge, 0.0, 1.0);
      // Floor memory: ground keeps a faint low-frequency shade plus a sparse, noise-broken pebble/crack
      // texture after the ring passes, fading on the wall afterimage's clock. Always far dimmer than the crease lines.
      float up = smoothstep(0.5, 0.85, N.y);
      float fmem = clamp(eglow / 0.18, 0.0, 1.0) * up;
      float lowf = 0.5 + 0.5 * (vnoise(vec3(vWorld.x * 0.45, 0.0, vWorld.z * 0.45)) * 0.7 + vnoise(vec3(vWorld.x * 0.15 + 5.0, 0.0, vWorld.z * 0.15)) * 0.3);
      // Soft value-noise shading (~4 cycles/m) plus sparse tiny grit specks (about 2 cm). No outlines, no cracks.
      float camD = distance(cameraPosition, vWorld);
      float soften = smoothstep(1.0, 2.2, camD);   // pattern fades out close to the camera, so it never grows into shapes
      float shade4 = vnoise(vec3(vWorld.x * 4.0, 1.0, vWorld.z * 4.0)) * 0.65 + vnoise(vec3(vWorld.x * 9.0, 2.0, vWorld.z * 9.0)) * 0.35;
      vec2 gp = vWorld.xz * 22.0;
      vec2 gc = floor(gp);
      vec2 gj = vec2(hash31(vec3(gc, 1.0)), hash31(vec3(gc, 2.0))) * 0.5 + 0.25;
      float gd = length(fract(gp) - gj);
      float gaa = max(length(fwidth(gp)), 1e-3);
      float speck = step(0.8, hash31(vec3(gc, 3.0))) * (1.0 - smoothstep(0.1 - gaa, 0.1 + gaa, gd)) * (1.0 - smoothstep(0.15, 0.5, gaa));
      float ground = clamp(0.6 * smoothstep(0.35, 0.75, shade4) * 0.6 + speck, 0.0, 1.0) * soften;
      vec3 floorMem = vec3(0.07, 0.25, 0.8) * fmem * (0.10 * lowf + 0.13 * ground) * (0.6 + 0.4 * fall);
      float soft = (0.06 * strata + 0.03 * cont) * fall;
      vec3 tint = N.y < -0.35 ? mix(uColor, vec3(0.55, 0.5, 1.0), 0.4) : uColor;
      // Edges fade from cyan to deep blue as they settle into the afterimage.
      vec3 etint = mix(vec3(0.1, 0.4, 1.0) * 1.5, tint, smoothstep(0.2, 0.7, eglow));
      vec3 viol = vec3(0.6, 0.3, 1.0);
      // Face fill (not the crease lines or the wavefront band) is capped by distance to the camera and kept under the bloom threshold.
      float nearF = smoothstep(0.6, 2.2, distance(cameraPosition, vWorld));
      vec3 faces = tint * glow * (0.025 + 0.05 * roof + (shape + soft) * tex)
          + tint * eglow * roof * 0.16 * (0.6 + 0.4 * fall) * tex        // roof afterimage: faces keep a dim lingering fill
          + tint * roof * 0.05 * smoothstep(10.0, 2.0, near) * tex       // roof sense: the ceiling over you is faintly felt
          + uColor * trail * (0.05 + 0.3 * shape * tex)
          + uFront * front * (0.12 + 0.55 * shape * tex)
          + viol * violet * 0.06;
      faces *= mix(0.45, 1.0, nearF);
      faces = min(faces, vec3(mix(0.16, 0.36, nearF)));
      // A crystal's answering pulse reads as a real wavefront on the rock: a soft bright band on faces as well as lines.
      faces += uFront * cfront * (0.16 + 0.34 * shape * tex) * mix(0.5, 1.0, nearF);
      col = faces
          + etint * eglow * 1.6 * lines * (0.45 + 0.55 * fall)
          + uColor * trail * 0.5 * lines
          + uFront * front * 1.5 * lines
          + viol * violet * 0.5 * lines
          + floorMem * (1.0 - 0.8 * lines)
          + light * (0.22 + 0.35 * lines);
      col = mix(col, col * vec3(0.8, 1.0, 1.15) + uColor * blur * 0.06, blur);
    }
    gl_FragColor = vec4(col * uStrength, alpha);
  }
`;class wb{constructor({speed:t,fade:e}){this.uniforms={uTime:{value:0},uPulse:{value:Array.from({length:na},()=>new Hi)},uPulseB:{value:Array.from({length:na},()=>new ne)},uCount:{value:0},uSpeed:{value:t},uFade:{value:e},uLight:{value:Array.from({length:Ro},()=>new Hi)},uLightColor:{value:Array.from({length:Ro},()=>new ti)},uLightCount:{value:0},uPlayer:{value:new Z}},this.materials=[]}material(t,{color:e=3139327,front:i=16056319,strength:n=1,glow:s=0}={}){const a={rock:0,creature:1,water:2,crystal:3}[t],o=t==="water",l=t==="crystal",h=new xr({vertexShader:bb,fragmentShader:Sb,uniforms:{...this.uniforms,uColor:{value:new ti(e)},uFront:{value:new ti(i)},uKind:{value:a},uStrength:{value:n},uGlow:{value:s}},side:l?gr:Mr,transparent:o||l,depthWrite:!o,blending:o?On:Uo});return h.extensions={derivatives:!0},h.toneMapped=!1,this.materials.push(h),h}setFade(t){this.uniforms.uFade.value=t}sync(t,e,i,n=[]){this.uniforms.uTime.value=t;const s=Math.min(na,e.length);for(let o=0;o<s;o+=1){const l=e[e.length-s+o];this.uniforms.uPulse.value[o].set(l.x,l.y,l.z,l.radius),this.uniforms.uPulseB.value[o].set(l.time,(l.wet?1:0)+(l.kind==="crystal"?2:0))}this.uniforms.uCount.value=s,this.uniforms.uPlayer.value.set(i.x,i.y+.3,i.z);const a=Math.min(Ro,n.length);for(let o=0;o<a;o+=1){const l=n[o];this.uniforms.uLight.value[o].set(l.x,l.y,l.z,l.radius),this.uniforms.uLightColor.value[o].set(l.color).multiplyScalar(l.intensity??1)}this.uniforms.uLightCount.value=a}}function Eb(r,{base:t=.25,rim:e=1.2,opacity:i=1,additive:n=!1}={}){const s=new xr({uniforms:{uColor:{value:new ti(r)},uBase:{value:t},uRim:{value:e},uOpacity:{value:i}},vertexShader:`
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,fragmentShader:`
      uniform vec3 uColor; uniform float uBase; uniform float uRim; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        gl_FragColor = vec4(uColor * (uBase + uRim * f), uOpacity * (uBase + f));
      }`,transparent:i<1||n,depthWrite:!n,blending:n?On:Uo,side:n?Mr:gr});return s.toneMapped=!1,s}const uf=650,fo=18,df=28,sh=360,Tb=`
  #define MAX_PULSES ${na}
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aEcho;
  uniform float uTime;
  uniform vec4 uPulse[MAX_PULSES];
  uniform vec2 uPulseB[MAX_PULSES];
  uniform int uCount;
  uniform float uSpeed;
  uniform float uFade;
  uniform vec3 uPlayer;
  uniform vec3 uCenter;
  uniform float uWrap;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    if (uWrap > 0.0) {
      // Motes live in a box that follows the creature: wrap each one into it, and drift.
      p = position + floor((uCenter - position) / uWrap + 0.5) * uWrap;
      p += vec3(sin(uTime * 0.21 + position.y * 1.7), sin(uTime * 0.17 + position.x * 1.3) * 0.6, cos(uTime * 0.19 + position.z * 1.1)) * 0.25;
    }
    float glow = 0.0;
    float front = 0.0;
    for (int i = 0; i < MAX_PULSES; i++) {
      if (i >= uCount) break;
      vec4 q = uPulse[i];
      float age = uTime - uPulseB[i].x;
      float wave = age * uSpeed;
      float d = distance(p, q.xyz);
      if (d > q.w || d > wave) continue;
      float since = age - d / uSpeed;
      float g = clamp(1.0 - since / uFade, 0.0, 1.0);
      float rim = smoothstep(q.w, q.w * 0.72, d);
      glow = max(glow, g * g * rim);
      float x = (wave - d) / 0.6;
      if (wave < q.w + 1.5) front = max(front, exp(-x * x) * rim);
    }
    float near = smoothstep(2.4, 0.4, distance(p, uPlayer)) * 0.35;
    vAlpha = aAlpha + aEcho * (glow * 0.55 + front * 1.1 + near);
    vColor = aColor * (1.0 + front * 0.8);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vAlpha < 0.004 ? 0.0 : clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 48.0);
  }
`,Ab=`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c) * 4.0;
    if (r > 1.0) discard;
    float k = (1.0 - r);
    gl_FragColor = vec4(vColor * vAlpha * k * k, 1.0);
  }
`;function rh(r){const t=new ze,e=i=>{const n=new ei(new Float32Array(r*i),i);return n.setUsage(aM),n};return t.setAttribute("position",e(3)),t.setAttribute("aColor",e(3)),t.setAttribute("aSize",e(1)),t.setAttribute("aAlpha",e(1)),t.setAttribute("aEcho",e(1)),t.boundingSphere=new Sr(new Z,1e5),t}class Cb{constructor(t,e,i,{seed:n=1}={}){this.rules=i,this.T=i.terrain,this.root=new Ee,this.root.name="fx.particles",t.add(this.root);let s=n>>>0;this.rand=()=>(s=s*1664525+1013904223>>>0,s/4294967296),this.uniforms={...e.uniforms,uCenter:{value:new Z},uWrap:{value:0},uScale:{value:300}};const a=l=>{const h=new xr({vertexShader:Tb,fragmentShader:Ab,uniforms:{...this.uniforms,uWrap:{value:l}},transparent:!0,depthWrite:!1,blending:On});return h.toneMapped=!1,h};this.dust=new Ql(rh(uf),a(fo)),this.dust.frustumCulled=!1,this.dust.name="fx.dust";const o=this.dust.geometry.attributes;for(let l=0;l<uf;l+=1){o.position.setXYZ(l,this.rand()*fo,this.rand()*fo,this.rand()*fo);const h=this.rand()<.2;o.aColor.setXYZ(l,h?.85:.6,h?.9:.95,1),o.aSize.setX(l,.035+this.rand()*.04),o.aAlpha.setX(l,0),o.aEcho.setX(l,.35+this.rand()*.5)}this.root.add(this.dust),this.drips=Array.from({length:df},()=>({live:!1})),this.dripMesh=new Ql(rh(df*3),a(0)),this.dripMesh.frustumCulled=!1,this.dripMesh.name="fx.drips",this.root.add(this.dripMesh),this.sparks=Array.from({length:sh},()=>({life:0})),this.sparkNext=0,this.sparkMesh=new Ql(rh(sh),a(0)),this.sparkMesh.frustumCulled=!1,this.sparkMesh.name="fx.sparks",this.root.add(this.sparkMesh),this.dripTimer=0,this.trailTimer=0}setScale(t){this.uniforms.uScale.value=t}dispose(){this.root.removeFromParent();for(const t of[this.dust,this.dripMesh,this.sparkMesh])t.geometry.dispose(),t.material.dispose()}spark(t,e,i,n,s,a,{color:o=[1,.69,.23],life:l=1.2,size:h=.07,drag:c=1.6,gravity:d=-.6,echo:u=0}={}){const f=this.sparkNext;this.sparkNext=(f+1)%sh,Object.assign(this.sparks[f],{x:t,y:e,z:i,vx:n,vy:s,vz:a,color:o,life:l,max:l,size:h,drag:c,gravity:d,echo:u})}burst(t,e,i,{color:n=[1,.69,.23],count:s=40,speed:a=3.2,rise:o=.6,life:l=1.1,size:h=.09}={}){for(let c=0;c<s;c+=1){const d=this.rand()*Math.PI*2,u=this.rand()*2-1,f=Math.sqrt(1-u*u),p=a*(.45+this.rand()*.55);this.spark(t,e,i,Math.cos(d)*f*p,u*p*.6+o,Math.sin(d)*f*p,{color:n,life:l*(.6+this.rand()*.5),size:h,drag:2.4,gravity:-1.2})}}#e(t){const e=this.drips.find(i=>!i.live);if(e)for(let i=0;i<6;i+=1){const n=t.x+(this.rand()-.5)*22,s=t.z+(this.rand()-.5)*22,a=Me(this.T,n,s),o=hn(this.T,n,s);if(!(!(o-a>1.2)||a>900)){Object.assign(e,{live:!0,x:n,z:s,y:o-.1,vy:0,floor:a,splash:0});return}}}update(t,e){const i=this.rules,n=i.player;if(this.uniforms.uCenter.value.set(n.x,n.y+1.2,n.z),i.phase==="playing"&&(this.dripTimer-=t,this.dripTimer<=0&&(this.dripTimer=.12+this.rand()*.25,this.#e(n)),this.trailTimer-=t,this.trailTimer<=0)){this.trailTimer=.05;for(const o of e){if(!o.group.visible)continue;const l=o.group.position;Math.hypot(l.x-n.x,l.z-n.z)>40||this.spark(l.x+(this.rand()-.5)*.15,l.y+(this.rand()-.5)*.1,l.z+(this.rand()-.5)*.15,(this.rand()-.5)*.3,-.12-this.rand()*.15,(this.rand()-.5)*.3,{life:1.1+this.rand()*.6,size:.045+this.rand()*.03,drag:.8,gravity:-.05})}}const s=this.dripMesh.geometry.attributes;this.drips.forEach((o,l)=>{o.live&&(o.splash?(o.splash-=t,o.splash<=0&&(o.live=!1)):(o.vy-=9.8*t,o.y+=o.vy*t,o.y<=o.floor+.02&&(o.splash=.35,o.y=o.floor+.03)));for(let h=0;h<3;h+=1){const c=l*3+h;if(!o.live){s.aAlpha.setX(c,0),s.aEcho.setX(c,0);continue}if(!o.splash)s.position.setXYZ(c,o.x,o.y+h*Math.min(.12,-o.vy*.012),o.z),s.aSize.setX(c,.05-h*.012),s.aAlpha.setX(c,.1-h*.025);else{const d=1-o.splash/.35,u=h*2.1;s.position.setXYZ(c,o.x+Math.cos(u)*d*.25,o.y+Math.sin(d*Math.PI)*.12,o.z+Math.sin(u)*d*.25),s.aSize.setX(c,.035),s.aAlpha.setX(c,.16*(1-d))}s.aColor.setXYZ(c,.55,.9,1),s.aEcho.setX(c,.9)}});for(const o of["position","aColor","aSize","aAlpha","aEcho"])s[o].needsUpdate=!0;const a=this.sparkMesh.geometry.attributes;this.sparks.forEach((o,l)=>{if(o.life>0){o.life-=t;const c=Math.exp(-o.drag*t);o.vx*=c,o.vy=o.vy*c+o.gravity*t,o.vz*=c,o.x+=o.vx*t,o.y+=o.vy*t,o.z+=o.vz*t}if(o.life<=0){a.aAlpha.setX(l,0),a.aEcho.setX(l,0);return}const h=o.life/o.max;a.position.setXYZ(l,o.x,o.y,o.z),a.aColor.setXYZ(l,o.color[0],o.color[1],o.color[2]),a.aSize.setX(l,o.size*(.5+.5*h)),a.aAlpha.setX(l,Math.min(1,h*1.6)*.9),a.aEcho.setX(l,o.echo)});for(const o of["position","aColor","aSize","aAlpha","aEcho"])a[o].needsUpdate=!0}}const Rb=10474239,ah=(r,t,e)=>Math.exp(-(((r-t)/e)**2));function Pb(){return{uTime:{value:0},uFade:{value:1},uGlow:{value:1},uFlash:{value:0},uFront:{value:-1},uOrigin:{value:new Z},uFwd:{value:new ne(0,-1)}}}const Ib=`
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec2 vUv;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`,Db=`
  uniform vec3 uColor; uniform float uBase; uniform float uRim; uniform float uAlpha;
  uniform float uTime; uniform float uFade; uniform float uGlow; uniform float uFlash; uniform float uFront;
  uniform vec3 uOrigin; uniform vec2 uFwd; uniform float uMode;
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec2 vUv;
  float ring() {
    float along = dot(vW.xz - uOrigin.xz, uFwd);
    return exp(-pow((along - uFront) / 0.17, 2.0)) * uFlash;
  }
  vec3 soft(vec3 c) { return c / (1.0 + 0.3 * max(c.r, max(c.g, c.b))); }`;function po(r,t,{base:e=.3,rim:i=1,alpha:n=1,mode:s=0}={}){const a=new xr({uniforms:{...r,uColor:{value:new ti(t)},uBase:{value:e},uRim:{value:i},uAlpha:{value:n},uMode:{value:s}},vertexShader:Ib,fragmentShader:Db+`
      void main() {
        if (uFade < 0.999) {
          // 4x4 ordered dither: the creature thins out when the camera is right behind it.
          vec2 q = floor(mod(gl_FragCoord.xy, 4.0));
          float b = mod(q.x * 5.0 + q.y * 3.0 + q.x * q.y * 2.0, 16.0) / 16.0 + 0.03;
          if (b > uFade) discard;
        }
        vec3 N = normalize(vN); vec3 V = normalize(vV);
        float fr = pow(1.0 - abs(dot(N, V)), 2.0);
        float up = N.y * 0.5 + 0.5;
        // Soft inner gradient: deeper blue underneath, paler on the back.
        vec3 inner = mix(uColor * vec3(0.3, 0.5, 0.95), uColor, up) * uBase;
        // Fur-edge shimmer: a slow sparkle only on the rim.
        float shim = 0.78 + 0.22 * sin(dot(vW, vec3(41.0, 57.0, 33.0)) + uTime * 2.4);
        float w = ring();
        vec3 col; float a = 1.0;
        if (uMode < 0.5) {
          col = inner * uGlow + uColor * uRim * fr * shim * uGlow;
          col += vec3(0.7, 0.95, 1.0) * (w * (0.5 + fr) + uFlash * 0.12 * (0.4 + fr));
        } else {
          // Ear: veins fan out from the base; edges and veins glow, the web between stays dim.
          float k = (vUv.x - 0.5) * 2.0 / (0.16 + vUv.y);
          float vein = 1.0 - smoothstep(0.0, 0.07, abs(fract(k * 1.5 + 0.5) - 0.5));
          vein *= smoothstep(0.02, 0.2, vUv.y) * (1.0 - smoothstep(0.78, 0.97, vUv.y));
          float edge = pow(abs(vUv.x - 0.5) * 2.0, 5.0) + pow(vUv.y, 7.0);
          if (uMode < 1.5) {
            col = uColor * (uBase + uRim * fr * 0.8 + vein * 0.7 + edge * 0.5) * uGlow;
            a = uAlpha * (0.55 + 0.35 * vein + 0.4 * edge + 0.3 * fr);
          } else {
            col = uColor * (uBase * (0.7 + 0.5 * vUv.y) + vein * 0.55 + fr * 0.35) * uGlow;
            a = uAlpha * (0.7 + 0.2 * vein);
          }
          col += vec3(0.8, 0.95, 1.0) * (w * 0.8 + uFlash * 0.1) * (0.5 + fr);
        }
        gl_FragColor = vec4(soft(col), clamp(a, 0.0, 1.0));
      }`,transparent:s>0,depthWrite:s===0,side:s>0?Mr:gr});return a.toneMapped=!1,a}function wp(r,t){const e=[],i=[];r.forEach(l=>{for(let h=0;h<t;h+=1){const c=h/t*Math.PI*2;e.push(Math.cos(c)*l.rx,l.y+Math.sin(c)*l.ry,l.z)}});for(let l=0;l<r.length-1;l+=1)for(let h=0;h<t;h+=1){const c=l*t+h,d=l*t+(h+1)%t,u=c+t,f=d+t;i.push(c,d,u,d,f,u)}const n=new ze;n.setAttribute("position",new ge(e,3)),n.setIndex(i),n.computeVertexNormals();const s=n.attributes.normal,a=n.attributes.position;let o=0;for(let l=0;l<a.count;l+=1)o+=s.getX(l)*a.getX(l)+s.getY(l)*(a.getY(l)-r[Math.floor(l/t)].y);if(o<0){const l=n.index.array;for(let h=0;h<l.length;h+=3){const c=l[h+1];l[h+1]=l[h+2],l[h+2]=c}n.computeVertexNormals()}return n}const Lb=r=>Math.sqrt(Math.max(0,1-Math.abs(2*r-1)**4));function Nb(){const r=[];for(let e=0;e<=22;e+=1){const i=e/22,n=.092+.036*ah(i,.22,.13)+.04*ah(i,.76,.15),s=Lb(i);r.push({z:-.16+.43*i,y:.27+.02*Math.sin(Math.PI*i)+.012*ah(i,.22,.12),rx:n*s,ry:n*1.12*s})}return wp(r,16)}function Fb(){const r=[];for(let e=0;e<=18;e+=1){const i=e/18,n=.04+.088*(1-i)**1.35,s=Math.sqrt(Math.max(0,1-(1-Math.min(1,i/.16))**2)),a=Math.sqrt(Math.max(0,1-(1-Math.min(1,(1-i)/.12))**2)),o=Math.min(s,a);r.push({z:.06-.34*i,y:-.03*i**1.5,rx:n*o,ry:n*.92*o})}return wp(r,14)}function ff(r,t,{v0:e=0,v1:i=1}={}){const a=[],o=[],l=[];for(let c=0;c<=12;c+=1){const d=e+(i-e)*(c/12),u=r*Math.pow(Math.max(0,Math.sin(Math.PI*Math.pow(d,.7))),.6)+.004;for(let f=0;f<=8;f+=1){const p=f/8*2-1,x=-.034*p*p*Math.sin(Math.PI*Math.min(1,d*1.1))+.03*d*d;a.push(p*u,d*t,x),o.push(f/8,d)}}for(let c=0;c<12;c+=1)for(let d=0;d<8;d+=1){const u=c*9+d,f=u+1,p=u+8+1,x=p+1;l.push(u,f,p,f,x,p)}const h=new ze;return h.setAttribute("position",new ge(a,3)),h.setAttribute("uv",new ge(o,2)),h.setIndex(l),h.computeVertexNormals(),h}function Ub(r){const t=[],e=new Z(0,1,0);for(let i=0;i<5;i+=1){const n=.2+.07*(1-Math.abs(i-1.5)/3.5)+(i===2?.03:0),s=new Ln(.0024,n,3,1,!0);s.translate(0,n/2,0);const a=.55+i*.32,o=(i-2)*.17+.05,l=new Z(r*Math.sin(a)*Math.cos(o),Math.sin(o),-Math.cos(a)*Math.cos(o)*.8-.1).normalize();s.applyQuaternion(new Gn().setFromUnitVectors(e,l)),s.translate(r*.03,-.012+i*.006,-.17-i*.005),t.push(s)}return os(t)}function zb(r,t,e,i=7){const n=new kn(t,r,e,i,1,!1);return n.translate(0,e/2,0),n.rotateX(Math.PI/2),n}function Ob(){const r=document.createElement("canvas");r.width=r.height=64;const t=r.getContext("2d"),e=t.createRadialGradient(32,32,0,32,32,32);return e.addColorStop(0,"rgba(0,0,0,0.85)"),e.addColorStop(.45,"rgba(0,0,0,0.5)"),e.addColorStop(1,"rgba(0,0,0,0)"),t.fillStyle=e,t.fillRect(0,0,64,64),new Pc(r)}const pf=[.236,.236,.222,.222],mf=[-.085,-.085,.15,.15],tn=.12,jn=.1,kb=.016;function Bb({glowSprite:r}){const t=Pb(),e=po(t,11854591,{base:.46,rim:1.2}),i=po(t,11853055,{base:.22,rim:1,alpha:.9,mode:1}),n=po(t,16762076,{base:.95,rim:.7,alpha:.85,mode:2}),s=po(t,16762076,{base:.8,rim:.8}),a=new ea({color:13626111,transparent:!0,opacity:.32,depthWrite:!1,side:Mr});a.toneMapped=!1;const o=new ea({color:15268863});o.toneMapped=!1;const l=new Ee;l.name="chr.player";const h=new Ee,c=new Jt(Nb(),e);c.position.y=0;const d=new Ee;d.position.y=.27,c.position.y=-.27,d.add(c);const u=new Ee;u.position.set(0,.385,-.125),u.add(new Jt(Fb(),e));const f=new Jt(new ci(.02,8,6),s);f.scale.set(1.1,.85,.9),f.position.set(0,-.03,-.268),u.add(f);for(const N of[-1,1]){const D=new Jt(new ci(.03,8,6),e);D.scale.set(.8,.34,1.35),D.position.set(N*.058,.046,-.07),D.rotation.set(0,N*.35,-N*.25),u.add(D),u.add(new Jt(Ub(N),a))}const p=[-1,1].map(N=>{const D=new Ee;D.position.set(N*.06,.075,.02);const $=new Jt(ff(.1,.3),i),Q=new Jt(ff(.07,.3,{v0:.1,v1:.82}),n);return Q.position.z=-.006,$.renderOrder=2,Q.renderOrder=3,D.add($,Q),D.rotation.z=-N*.5,u.add(D),D}),x=pf.map((N,D)=>{const $=D%2===0?-1:1,Q=new Ee;Q.position.set($*.088,N,mf[D]);const st=new kn(D<2?.03:.036,.021,tn,8);st.translate(0,-tn/2,0);const rt=new Jt(st,e),U=new Ee;U.position.y=-tn;const at=new kn(.021,.014,jn,7);at.translate(0,-jn/2,0);const bt=new Jt(new ci(.021,7,5),e),_t=new Jt(at,e),X=new Ee;X.position.y=-jn;const nt=new Jt(new ci(.03,8,6),e);return nt.scale.set(1,.55,1.45),nt.position.set(0,.002,-.014),X.add(nt),U.add(bt,_t,X),Q.add(rt,U),l.add(Q),{hip:Q,upper:rt,knee:U,ankle:X,s:$,front:D<2,i:D}}),m=new Ee;m.position.set(0,.275,.25);const g=[.032,.024,.017,.011,.006],v=[];let S=m;for(let N=0;N<4;N+=1){const D=new Ee;D.rotation.x=-.2,D.position.z=N===0?0:.075;const $=new Jt(zb(g[N],g[N+1],.075),e),Q=new Jt(new ci(g[N],7,5),e);D.add($,Q),S.add(D),S=D,v.push(D)}const _=new Ee;_.position.z=.075,_.add(new Jt(new ci(.0125,8,6),o));const E=r(12577535,.16,.7);_.add(E),S.add(_),h.add(d,u,m);const b=r(Rb,1.3,.22);b.position.y=.3;const A=new Jt(new ua(1,1).rotateX(-Math.PI/2),new ea({map:Ob(),transparent:!0,depthWrite:!1,opacity:.7,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));A.name="chr.shadow",A.renderOrder=1,A.scale.set(.78,1,1.1),l.add(h,b);const y={phase:0,crouch:0,startle:0,flare:0,ring:99,ringAmp:0,twitch:99,twitchEar:0,nextTwitch:2.5,headYaw:0,speed:0,time:0,lead:0,swayAmp:0};function w(N,D,$,Q){const st=D-N.hip.position.z;let rt=$-N.hip.position.y,U=Math.hypot(st,rt);const at=tn+jn-.002,bt=Math.abs(tn-jn)+.01,_t=Math.min(at,Math.max(bt,U)),X=(tn*tn-jn*jn+_t*_t)/(2*_t),nt=Math.sqrt(Math.max(0,tn*tn-X*X)),et=st/(U||1),Rt=rt/(U||1),Dt=Rt*Q,yt=-et*Q,te=et*X+Dt*nt,St=Rt*X+yt*nt,Ft=Math.atan2(-te,-St),kt=et*_t,Ot=Rt*_t,se=Math.atan2(-(kt-te),-(Ot-St));N.hip.rotation.x=Ft,N.knee.rotation.x=se-Ft,N.ankle.rotation.x=-se+0}function C(N,{speed:D=0,sneaking:$=!1,lead:Q=0,charging:st=!1,wet:rt=!1}={}){y.time+=N;const U=y.time;t.uTime.value=U,y.speed+=(D-y.speed)*(1-Math.exp(-N*8));const at=y.speed,bt=at>.03;y.phase+=N*(3.5+at*13)*(bt?1:0),y.crouch+=(($?1:0)-y.crouch)*(1-Math.exp(-N*9)),y.startle=Math.max(0,y.startle-N/.45),y.flare=Math.max(0,y.flare-N/.7),y.ring+=N,y.twitch+=N;const _t=y.crouch,X=Math.sin(y.startle*Math.PI),nt=Math.sin(U*2.2),et=y.ring;t.uFront.value=-.3+et*3.2,t.uFlash.value=y.ringAmp*Math.exp(-et*4.2)*(et<1.4?1:0),t.uGlow.value=1+.1*nt+.05*at,b.material.opacity=.2+.05*nt+t.uFlash.value*.18,E.material.opacity=.55+.25*Math.sin(U*3.1)+t.uFlash.value*.4;const Rt=Math.abs(Math.sin(y.phase))*.026*at,Dt=-.058*_t+Rt+X*.045+nt*.004;h.position.y=Dt,h.rotation.z=Math.sin(y.phase)*.03*at,h.rotation.x=X*-.1+_t*.04,d.scale.set(1+nt*.012,1+nt*.026-_t*.08,1+_t*.04);const yt=Math.max(-.75,Math.min(.75,Q*1.1));y.headYaw+=(yt+Math.sin(U*.7)*.05*(1-at)-y.headYaw)*(1-Math.exp(-N*9)),u.rotation.y=y.headYaw,u.rotation.x=.04*nt+_t*.18-X*.2+Math.sin(y.phase*2)*.03*at-(st?.12:0),u.position.set(0,.385-.035*_t+X*.01,-.125-.02*_t),y.twitch>y.nextTwitch&&(y.twitch=0,y.nextTwitch=2.5+Math.random()*3.5,y.twitchEar=Math.random()<.5?0:1),p.forEach((St,Ft)=>{const kt=Ft?1:-1,Ot=y.flare,se=Ot*Ot*(3-2*Ot),me=y.twitch<.28&&Ft===y.twitchEar?Math.sin(y.twitch/.28*Math.PI):0,xe=-kt*(.5+.28*se-.12*_t+(st?-.3:0))+kt*me*.35+Math.sin(U*1.7+Ft)*.03,be=-.55*se-(st?.3:0)+.5*X+.3*_t+me*.2;St.rotation.z+=(xe-St.rotation.z)*(1-Math.exp(-N*16)),St.rotation.x+=(be-St.rotation.x)*(1-Math.exp(-N*16))});const te=.18+.32*at;v.forEach((St,Ft)=>{St.rotation.y=Math.sin(U*(2+at*4)-Ft*.8+y.phase*.5)*te*(.5+Ft*.25),St.rotation.x=-.2-Ft*.03-.1*X+.08*_t*(Ft===0?1:0)}),m.position.y=.275+Dt*.8,x.forEach(St=>{const Ft=(St.front?St.s<0:St.s>0)?0:Math.PI,kt=Math.sin(y.phase+Ft),Ot=Math.max(0,Math.cos(y.phase+Ft)),se=.075*(1-.35*_t);St.hip.position.y=pf[St.i]+Dt*.9;const xe=mf[St.i]+(St.front?-.012:.03)+(St.front?-.03:.02)*_t+kt*se*at,be=kb+Ot*.045*at*(St.front?1:1.2);w(St,xe,be,St.front?-1:1)})}function R(N=1,D=!1){y.ring=0,y.ringAmp=D?.18:.3+.45*Math.min(1,N),y.flare=1}function I(){y.startle=1}function z(){let N=0;return l.traverse(D=>{if(D.isMesh){const $=D.geometry;N+=($.index?$.index.count:$.attributes.position.count)/3}}),Math.round(N)}function G(N,D){t.uOrigin.value.copy(N),t.uFwd.value.set(-Math.sin(D),-Math.cos(D))}function L(N){t.uFade.value=N;const D=N>.02;h.visible=D,b.visible=N>.6,x.forEach($=>{$.hip.visible=D}),a.opacity=.32*N}return{group:l,setFade:L,body:h,head:u,ears:p,legs:x,halo:b,torso:d,shadow:A,update:C,pulse:R,startle:I,triangles:z,setUniformsFor:G,state:y,shared:t}}function Ep(r){let t=r*2654435761>>>0||1;return()=>(t^=t<<13,t>>>=0,t^=t>>>17,t^=t<<5,t>>>=0,t/4294967296)}const En=(r,t,e)=>{const i=Math.sin(r*127.1+t*311.7+e*74.7)*43758.5453;return i-Math.floor(i)};function Tp(r,t,e){const i=Math.floor(r),n=Math.floor(t),s=Math.floor(e),a=r-i,o=t-n,l=e-s,h=a*a*(3-2*a),c=o*o*(3-2*o),d=l*l*(3-2*l),u=(f,p,x)=>f+(p-f)*x;return u(u(u(En(i,n,s),En(i+1,n,s),h),u(En(i,n+1,s),En(i+1,n+1,s),h),c),u(u(En(i,n,s+1),En(i+1,n,s+1),h),u(En(i,n+1,s+1),En(i+1,n+1,s+1),h),c),d)}function Ap(r,{hanging:t=!1,segs:e=7,rings:i=7}={}){const n=Ep(r),s=n()*Math.PI*2,a=.12+n()*.28,o=[.25+n()*.15,.55+n()*.15],l=[.14+n()*.12,.1+n()*.12],h=.2+n()*.14,c=.25+n()*.25,d=n()*50,u=t?-1:1,f=p=>{const x=[];for(let S=0;S<=i;S+=1){const _=S/i;let E=Math.pow(1-_,1.25)*(1+c*Math.pow(1-_,6));if(!p)for(let y=0;y<2;y+=1){const w=(_-o[y])/.07;E*=1+l[y]*Math.exp(-w*w)}S===i?E=.03:S===i-1&&(E=Math.max(E,.09)*.85);const b=p?0:Math.cos(s)*a*_*_,A=p?0:Math.sin(s)*a*_*_;for(let y=0;y<e;y+=1){const w=y/e*Math.PI*2;let C=E;!p&&S<i&&(C*=1+h*(Tp(Math.cos(w)*1.6+d,_*4,Math.sin(w)*1.6)*2-1)),x.push(b+Math.cos(w)*C,u*_,A+Math.sin(w)*C)}}const m=[x.length/3];x.push(0,u*1.02,0);const g=[];for(let S=0;S<i;S+=1)for(let _=0;_<e;_+=1){const E=S*e+_,b=S*e+(_+1)%e,A=E+e,y=b+e;t?g.push(E,b,A,b,y,A):g.push(E,A,b,b,A,y)}for(let S=0;S<e;S+=1){const _=i*e+S,E=i*e+(S+1)%e;t?g.push(_,E,m[0]):g.push(_,m[0],E)}const v=new ze;return v.setAttribute("position",new ge(x,3)),v.setIndex(g),v};return{geo:f(!1),clean:f(!0),hanging:t}}function Vb(r,t){const e=new ci(1,6,4);return e.deleteAttribute("normal"),e.deleteAttribute("uv"),e.scale(r,t,r),e.translate(0,-1.07-t,0),e}function Gb(r){const t=Ap(r,{hanging:!0}),e=i=>os([i.toNonIndexed(),Vb(.2,.07).toNonIndexed()]);return{geo:e(t.geo),clean:e(t.clean)}}function Hb(r,t,e){const i=new kn(r,r*1.04,t,6,1,!0);i.translate(0,t/2,0);const n=new Ln(r,e,6,1,!0);return n.translate(0,t+e/2,0),[i.toNonIndexed(),n.toNonIndexed()]}function mo(r,{scale:t=1,minCount:e=5,maxCount:i=9}={}){const n=Ep(r*7919+13),s=e+Math.floor(n()*(i-e+1)),a=[],o=n()*Math.PI*2;for(let c=0;c<s;c+=1){const d=c===0,u=o+c*2.399+n()*.5,f=d?0:(.09+n()*.15)*t,p=(d?.09+n()*.03:.05+n()*.04)*t,x=(d?.9+n()*.35:.3+n()*.5)*t,m=p*(1.5+n()*1.2),g=d?n()*.12:.25+n()*.4,v=Hb(p,x,m);for(const S of v)S.rotateZ(-g*Math.cos(u)),S.rotateX(g*Math.sin(u)),S.rotateY(n()*0+u*.35),S.translate(Math.cos(u)*f,.02*t,Math.sin(u)*f),a.push(S)}const l=new Lc(.3*t,1),h=l.attributes.position;for(let c=0;c<h.count;c+=1){const d=h.getX(c),u=h.getY(c),f=h.getZ(c),p=1+.28*(Tp(d*7+r,u*7,f*7)-.5);h.setXYZ(c,d*p,Math.max(u,-.02)*.45*p-.02*t,f*p)}return l.computeVertexNormals(),{crystal:os(a),base:l.toNonIndexed()}}const fe={sonar:3139327,amber:16756794,eye:16721446,player:10474239,beast:16761538,great:16751226,listener:14727423,checkpoint:8257496,exit:13629695,crystal:11832575,water:6279423};let tr=null;function Wb(){if(tr)return tr;const r=document.createElement("canvas");r.width=r.height=64;const t=r.getContext("2d"),e=t.createRadialGradient(32,32,0,32,32,32);return e.addColorStop(0,"rgba(255,255,255,1)"),e.addColorStop(.25,"rgba(255,255,255,0.45)"),e.addColorStop(1,"rgba(255,255,255,0)"),t.fillStyle=e,t.fillRect(0,0,64,64),tr=new Pc(r),tr.colorSpace=li,tr}function Rn(r,t,e=1,i=!0){const n=new mp(new Rc({map:Wb(),color:r,transparent:!0,opacity:e,blending:On,depthWrite:!1,depthTest:i}));return n.scale.setScalar(t),n}let Wr=null;function Xb(){if(Wr)return Wr;const r=document.createElement("canvas");r.width=r.height=128;const t=r.getContext("2d");t.strokeStyle="#ffb03a",t.lineCap="round",t.lineWidth=5,t.beginPath(),t.arc(64,64,34,0,Math.PI*2),t.stroke(),t.lineWidth=6;for(let e=0;e<4;e++){const i=e*Math.PI/2;t.beginPath(),t.moveTo(64+Math.cos(i)*44,64+Math.sin(i)*44),t.lineTo(64+Math.cos(i)*58,64+Math.sin(i)*58),t.stroke()}return Wr=new Pc(r),Wr.colorSpace=li,Wr}function ur(r,t={}){const e=new ea({color:r,...t});return e.toneMapped=!1,e}function Kr(r,t=null){const e=r.index?r.toNonIndexed():r,n=(t?t.index?t.toNonIndexed():t:e).attributes.position.array,s=n.length/9,a=new Float32Array(s*3),o=u=>`${Math.round(n[u]*200)},${Math.round(n[u+1]*200)},${Math.round(n[u+2]*200)}`,l=new Map,h=(u,f)=>u<f?`${u}|${f}`:`${f}|${u}`;for(let u=0;u<s;u+=1){const f=u*9,p=n[f+3]-n[f],x=n[f+4]-n[f+1],m=n[f+5]-n[f+2],g=n[f+6]-n[f],v=n[f+7]-n[f+1],S=n[f+8]-n[f+2];let _=x*S-m*v,E=m*g-p*S,b=p*v-x*g;const A=Math.hypot(_,E,b)||1;a[u*3]=_/A,a[u*3+1]=E/A,a[u*3+2]=b/A;const y=[o(f),o(f+3),o(f+6)];for(let w=0;w<3;w+=1){const C=h(y[(w+1)%3],y[(w+2)%3]),R=l.get(C);R?R.push(u):l.set(C,[u])}}const c=new Float32Array(s*9),d=new Float32Array(s*9);for(let u=0;u<s;u+=1){const f=u*9,p=[o(f),o(f+3),o(f+6)];for(let x=0;x<3;x+=1){const m=l.get(h(p[(x+1)%3],p[(x+2)%3]));let g=.5;const v=m.find(S=>S!==u);v!==void 0&&(g=1-(a[u*3]*a[v*3]+a[u*3+1]*a[v*3+1]+a[u*3+2]*a[v*3+2]));for(let S=0;S<3;S+=1)d[f+S*3+x]=g,c[f+S*3+x]=S===x?1:0}}return e.setAttribute("bary",new ei(c,3)),e.setAttribute("crease",new ei(d,3)),e}const Ks=.3,qb=.035,$b=.25,Yb=.06;function Tn(r,t,e){const i=Math.sin(r*127.1+t*311.7+e*74.7)*43758.5453;return i-Math.floor(i)}function go(r,t,e){const i=Math.floor(r),n=Math.floor(t),s=Math.floor(e),a=r-i,o=t-n,l=e-s,h=a*a*(3-2*a),c=o*o*(3-2*o),d=l*l*(3-2*l),u=(f,p,x)=>f+(p-f)*x;return u(u(u(Tn(i,n,s),Tn(i+1,n,s),h),u(Tn(i,n+1,s),Tn(i+1,n+1,s),h),c),u(u(Tn(i,n,s+1),Tn(i+1,n,s+1),h),u(Tn(i,n+1,s+1),Tn(i+1,n+1,s+1),h),c),d)}const Bo=(r,t,e)=>{const i=Math.min(1,Math.max(0,(e-r)/(t-r)));return i*i*(3-2*i)};function Zb(r){const t=(r.nx-1)*r.res,e=(r.nz-1)*r.res,i=Math.ceil(t/Ks)+1,n=Math.ceil(e/Ks)+1,s=i*n,a=new Float32Array(s*2*3),o=new Float32Array(s);for(let p=0;p<n;p+=1)for(let x=0;x<i;x+=1){const m=p*i+x,g=Math.min(x*Ks,t),v=Math.min(p*Ks,e);a.set([g,Me(r,g,v),v],m*3),a.set([g,hn(r,g,v),v],(s+m)*3),o[m]=JM(r,g,v)}const l=new Float32Array(a),h=new Float32Array(s*2),c=(p,x,m)=>a[(p+Math.min(Math.max(m,0),n-1)*i+Math.min(Math.max(x,0),i-1))*3+1];for(let p=0;p<2;p+=1){const x=p*s,m=p===0?1:-1;for(let g=0;g<n;g+=1)for(let v=0;v<i;v+=1){const S=x+g*i+v,_=a[S*3],E=a[S*3+1],b=a[S*3+2],A=(c(x,v+1,g)-c(x,v-1,g))/(Ks*2),y=(c(x,v,g+1)-c(x,v,g-1))/(Ks*2);let w=-A*m,C=m,R=-y*m;const I=Math.hypot(w,C,R);w/=I,C/=I,R/=I,h[S]=C*m;const z=(go(_*.8+3.1,E*.8,b*.8)+.5*go(_*1.7,E*1.7+9,b*1.7)-.75)*(2/1.5),G=(go(_*3.3+7,E*3.3,b*3.3)+.5*go(_*6.9,E*6.9+4,b*6.9)-.75)*(2/1.5),L=p===1?1:1-Bo(.4,.8,h[S]);let N=(1-L)*qb*G+L*($b*z+Yb*G);N*=1-Bo(.93,.995,o[g*i+v]),l[S*3]=_+w*N,l[S*3+1]=E+C*N,l[S*3+2]=b+R*N}}const d=[];for(let p=0;p<n-1;p+=1)for(let x=0;x<i-1;x+=1){const m=p*i+x,g=m+1,v=m+i+1,S=m+i;o[m]>.985&&o[g]>.985&&o[v]>.985&&o[S]>.985||(d.push(m,v,g,m,S,v),d.push(s+m,s+g,s+v,s+m,s+v,s+S))}const u=p=>{const x=new ze;return x.setAttribute("position",new ei(p,3)),x.setIndex(d),x},f=u(l);return f.computeBoundingSphere(),f.userData={base:u(a),floorVertices:s,normalY:h,mx:i,mz:n},f}function Kb(r){const t=Zb(r),e=Kr(t,t.userData.base);return e.computeBoundingSphere(),e}function Jb(r,t,e=0,i=0,n=0){const s=new Jt(r,t);return s.position.set(e,i,n),s}function Qb(r,t){const e=new Ee,i=r==="listener",n=new ci(.6,9,6);n.scale(i?.7:.85,i?.5:.55,1.35);const s=[n];for(let x=0;x<6;x+=1){const m=new Ln(.07,.34+Math.sin(x*.9)*.1,4);m.rotateX(.6),m.translate(0,.3-Math.abs(x-2)*.03,-.55+x*.25),s.push(m)}const a=new Jt(os(s.map(x=>x.toNonIndexed())),t);a.position.y=i?.72:.6;const o=new Ee;o.position.set(0,i?.82:.68,-.95);const l=new ci(.32,8,6);l.scale(1,.8,1.2);const h=new Ln(.22,.55,6);h.rotateX(-Math.PI/2),h.translate(0,-.12,-.38);const c=[l.toNonIndexed(),h.toNonIndexed()];if(i)for(const x of[-1,1]){const m=new Ln(.12,.62,5);m.rotateZ(-x*.45),m.translate(x*.22,.38,.05),c.push(m.toNonIndexed())}o.add(new Jt(os(c),t));const d=new Ee;for(const x of[-1,1])d.add(Jb(new ci(.06,8,6),ur(fe.eye),x*.14,.06,-.28));const u=Rn(fe.eye,1.3,.8);u.position.set(0,.06,-.3),d.add(u),d.visible=!1,o.add(d);const f=i?.75:.6,p=[[-1,-.5],[1,-.5],[-1,.6],[1,.6]].map(([x,m])=>{const g=new Ee;g.position.set(x*.42,f,m);const v=new Ln(.1,f,5);return v.rotateZ(Math.PI),v.translate(x*.08,-f/2,0),g.add(new Jt(v,t)),g.rotation.z=x*.25,g});return e.add(a,o,...p),r==="great"&&e.scale.setScalar(1.75),{group:e,torso:a,head:o,eyes:d,legs:p}}function jb(){const r=new Ee,t=new Jt(new Ic(.06,.18,4,8),ur(16751918));t.rotation.x=Math.PI/2;const e=new ze;e.setAttribute("position",new ei(new Float32Array([0,0,-.1,.34,0,-.2,.26,0,.16]),3));const i=ur(fe.amber,{side:Mr,transparent:!0,opacity:.85}),n=new Jt(e,i),s=new Jt(e,i);n.scale.setScalar(1.5),s.scale.set(-1.5,1.5,1.5);const a=Rn(16751138,2.4,.8),o=new mp(new Rc({map:Xb(),color:fe.amber,transparent:!0,opacity:0,blending:On,depthWrite:!1,depthTest:!0}));return o.visible=!1,r.add(t,n,s,a),{group:r,left:n,right:s,halo:a,mark:o}}class gf{constructor(t,e,{particles:i=!0}={}){this.host=t,this.rules=e,this.level=e.level,this.terrain=e.terrain,this.sonar=new wb({speed:e.tuning.pulseSpeed,fade:e.echoFade}),this.time=0,this.root=new Ee,this.root.name=`level:${this.level.id}`,this.bursts=[],this.playerY=e.player.y,this.walkPhase=0,this.#e(),this.#n(),this.#a(),this.#o(),this.#t(),this.#r(),this.#u(),this.particles=i?new Cb(this.root,this.sonar,e,{seed:this.level.width*31+this.level.height}):null,this.exitFlash=0,t.add(this.root,"environment")}dispose(){this.offs?.forEach(t=>t()),this.particles?.dispose(),this.host.remove(this.root),this.root.traverse(t=>{t.geometry?.dispose?.(),t.material&&t.material.map!==tr&&t.material.dispose?.()})}#e(){const t=this.terrain,e=new Jt(Kb(t),this.sonar.material("rock"));e.name="env.cave",this.root.add(e),this.#i(t),this.#s();const i=this.level;if(i.water){const n=[];i.def.water?.depth;for(let a=0;a<i.height;a+=1)for(let o=0;o<i.width;o+=1){if(!i.water[a*i.width+o])continue;const l=new ua(Wt+.6,Wt+.6);l.rotateX(-Math.PI/2),l.translate((o+.5)*Wt,-.06+(i.def.water?.y??0),(a+.5)*Wt),n.push(l)}const s=new Jt(os(n),this.sonar.material("water",{color:fe.water,strength:.9}));s.name="env.water",s.renderOrder=2,this.root.add(s)}}#i(t){const e=this.sonar.material("rock",{strength:1.1}),i=(o,l,h)=>{if(!l.length)return;const c=Kr(o.geo,o.clean),d=c.attributes.crease;for(let p=0;p<d.count*3;p+=1)d.array[p]*=.7;const u=new DM(c,e,l.length),f=new Je;l.forEach((p,x)=>{h(f,p,x),f.updateMatrix(),u.setMatrixAt(x,f.matrix)}),u.instanceMatrix.needsUpdate=!0,u.computeBoundingSphere(),u.name="env.stalagmites",this.root.add(u)},n=(o,l)=>{const h=Math.sin(o.x*12.9898+o.z*78.233+l*37.719)*43758.5453;return h-Math.floor(h)},s=(o,l)=>Array.from({length:l},(h,c)=>o.filter(d=>Math.floor(n(d,1)*l)===c)),a=t.stalagmites.filter(o=>!o.crystal);s(a,3).forEach((o,l)=>i(Ap(11+l*7,{segs:7+l%2,rings:7}),o,(h,c)=>{const d=.9+n(c,2)*.1;h.position.set(c.x,c.y,c.z),h.rotation.set(0,n(c,3)*Math.PI*2,0),h.scale.set(c.radius*d,c.height,c.radius*d*(.92+n(c,4)*.08))})),s(t.stalactites,3).forEach((o,l)=>i(Gb(31+l*5),o,(h,c)=>{h.position.set(c.x,c.y,c.z),h.rotation.set(0,n(c,5)*Math.PI*2,0),h.scale.set(c.radius,c.length,c.radius)}))}#s(){const t=[],e=(n,s,a,o)=>{const l=Kr(n.base);l.translate(s,a,o),t.push(l)};if(this.rules.crystals.forEach((n,s)=>e(mo(s+1),n.x,n.y-.05,n.z)),this.rules.checkpoints.forEach((n,s)=>{n.start||e(mo(100+s,{scale:.7,minCount:4,maxCount:6}),n.x,n.y,n.z)}),!t.length)return;const i=new Jt(os(t),this.sonar.material("rock",{strength:1.1}));i.name="env.crystalbases",this.root.add(i),this.crystalBases=i}#n(){this.creature=Bb({glowSprite:Rn}),this.root.add(this.creature.group,this.creature.shadow),this.offs=[this.rules.on("pulse",e=>this.creature.pulse(e.loudness??1)),this.rules.on("softPulse",()=>this.creature.pulse(.3,!0)),this.rules.on("beastWake",e=>{const i=this.rules.player;Math.hypot(e.x-i.x,e.z-i.z)<14&&this.creature.startle()})];const t=new Jt(new ci(1,32,16),Eb(fe.sonar,{base:0,rim:.5,additive:!0,opacity:.6}));t.visible=!1,this.chargeShell=t,this.root.add(t)}#a(){this.moths=this.rules.moths.map((t,e)=>{const i=jb();return i.group.name=`prop.moth:${t.id}`,i.group.position.set(t.x,t.y+1,t.z),i.mark.position.set(t.x,t.y+1,t.z),i.mark.name=`fx.mothmark:${t.id}`,this.root.add(i.group,i.mark),{...i,id:t.id,phase:e*1.7,baseX:t.x,baseY:t.y,baseZ:t.z,seenAt:-1/0}})}#o(){const t={sleeper:this.sonar.material("creature",{color:fe.beast,front:16777215}),listener:this.sonar.material("creature",{color:fe.listener,front:16777215}),great:this.sonar.material("creature",{color:fe.great,front:16777215,strength:1.2})};this.beasts=this.rules.beasts.map((e,i)=>{const n=Qb(e.kind,t[e.kind]);return n.group.name=`chr.beast:${e.id}`,this.root.add(n.group),{...n,id:e.id,kind:e.kind,phase:i*2.3,stride:0,rise:0}})}#t(){this.crystals=this.rules.crystals.map((t,e)=>{const i=new Ee;i.name=`prop.crystal:${t.id}`;const n=this.sonar.material("crystal",{color:fe.crystal,front:16777215,glow:.18}),s=new Jt(Kr(mo(e+1).crystal),n);i.add(s);const a=Rn(fe.crystal,3,.15);return a.position.y=1,i.add(a),i.position.set(t.x,t.y-.05,t.z),this.root.add(i),{id:t.id,group:i,mat:n,halo:a}})}#r(){this.checkpoints=this.rules.checkpoints.map((t,e)=>{const i=new Ee;i.name=`prop.checkpoint:${t.id}`;const n=this.sonar.material("crystal",{color:fe.checkpoint,front:16777215,glow:.12}),s=new Jt(Kr(mo(100+e,{scale:.7,minCount:4,maxCount:6}).crystal),n),a=Rn(fe.checkpoint,2.4,.15);return a.position.y=.75,i.add(s,a),i.position.set(t.x,t.y,t.z),i.visible=!t.start,this.root.add(i),{id:t.id,group:i,crystal:s,halo:a}})}#u(){const t=this.level.exit,e=new Ee;e.name="prop.exit";const i=new Jt(new Oo(1.1,.07,6,40),ur(fe.exit,{transparent:!0,opacity:.15}));i.rotation.x=Math.PI/2,i.position.y=.08;const n=[0,1,2].map(()=>{const l=new Jt(new Oo(.9,.04,4,40),ur(fe.exit,{transparent:!0,opacity:0,blending:On,depthWrite:!1}));return l.rotation.x=Math.PI/2,e.add(l),l}),s=new Jt(new kn(.9,1.1,6,24,1,!0),ur(fe.exit,{transparent:!0,opacity:0,blending:On,depthWrite:!1,side:Mr}));s.position.y=3;const a=Rn(fe.exit,5,0);a.position.y=1.2;const o=Rn(fe.exit,2.2,0,!1);o.position.y=1.6,o.renderOrder=10,e.add(i,s,a,o),e.position.set(t.x,t.y,t.z),this.root.add(e),this.exit={group:e,ring:i,rings:n,halo:a,beam:s,beacon:o}}burst(t,e,i,n,s=4,{sparks:a=0}={}){const o=Rn(n,.5,1);if(o.position.set(t,e+1,i),this.root.add(o),this.bursts.push({sprite:o,age:0,size:s}),a&&this.particles){const l=new ti(n);this.particles.burst(t,e+1,i,{color:[l.r,l.g,l.b],count:a})}}exitOpened(){const t=this.level.exit;this.exitFlash=1,this.burst(t.x,t.y,t.z,fe.exit,9),this.particles?.burst(t.x,t.y+.4,t.z,{color:[.8,.97,1],count:70,speed:2.4,rise:3.2,life:1.8,size:.1})}snapFacing(){this.creature.group.rotation.y=this.rules.player.facing}setPointScale(t){this.pointScale=t,this.particles?.setScale(t)}setFirstPerson(t){this.creature.body.visible=!t,this.creature.halo.visible=!t,this.creature.shadow.visible=!t,this.creature.legs.forEach(e=>{e.hip.visible=!t})}#l(t,e){const i=this.terrain,n=Me(i,e.x,e.z),s=.3,a=Me(i,e.x+s,e.z)-Me(i,e.x-s,e.z),o=Me(i,e.x,e.z+s)-Me(i,e.x,e.z-s),l=Math.max(Math.abs(Me(i,e.x+s,e.z)-n),Math.abs(Me(i,e.x-s,e.z)-n),Math.abs(Me(i,e.x,e.z+s)-n),Math.abs(Me(i,e.x,e.z-s)-n)),h=Math.max(0,this.playerY-n),c=new Z(-a/(2*s),1,-o/(2*s)).normalize(),d=t.shadow;d.position.set(e.x,n+.02,e.z),d.quaternion.setFromUnitVectors(new Z(0,1,0),c),d.quaternion.multiply(new Gn().setFromAxisAngle(new Z(0,1,0),t.group.rotation.y));const u=(1-Bo(.05,.7,h))*(1-.7*Bo(.25,.9,l));d.material.opacity=.75*u,d.visible=u>.01&&this.creature.body.visible}#h(){const t=this.rules,e=t.player,i=[{x:e.x,y:e.y+.4,z:e.z,radius:2.6,color:fe.player,intensity:.55}];t.exitOpen&&i.push({x:t.level.exit.x,y:t.level.exit.y+1.2,z:t.level.exit.z,radius:12,color:fe.exit,intensity:1.5+this.exitFlash*1.5});const n=t.moths.filter(a=>!a.collected).map(a=>({m:a,d:Math.hypot(a.x-e.x,a.z-e.z)})).sort((a,o)=>a.d-o.d).slice(0,3);for(const{m:a}of n)i.push({x:a.x,y:a.y+1,z:a.z,radius:6,color:fe.amber,intensity:1.1});const s=t.checkpoints[t.checkpointIndex];s.start||i.push({x:s.x,y:s.y+.8,z:s.z,radius:3.5,color:fe.checkpoint,intensity:.6});for(const a of t.beasts)a.kind==="great"&&t.chase&&i.length<8&&i.push({x:a.x,y:a.y+1.6,z:a.z,radius:3.5,color:fe.eye,intensity:.5});return i}render(t){this.time+=t;const e=this.rules,i=e.player;this.sonar.setFade(e.echoFade),this.sonar.sync(e.clock,e.pulses,i,this.#h());const n=this.creature;this.playerY=i.y>this.playerY?i.y:Math.max(i.y,this.playerY-t*6),n.group.position.set(i.x,this.playerY,i.z);let s=i.facing-n.group.rotation.y;s=Math.atan2(Math.sin(s),Math.cos(s));const a=s;n.group.rotation.y+=s*(1-Math.exp(-t*12));const o=Math.min(1,i.speed/e.tuning.playerSpeed),l=e.charge!==null;if(n.setUniformsFor(n.group.position,n.group.rotation.y),n.update(t,{speed:o,sneaking:i.sneaking,lead:a,charging:l}),this.#l(n,i),this.chargeShell.visible=l,l){const x=e.chargeRadius()*(e.inWater?e.tuning.waterPulseScale:1);this.chargeShell.scale.setScalar(x),this.chargeShell.position.set(i.x,i.y+e.tuning.pulseHeight,i.z),this.chargeShell.material.uniforms.uOpacity.value=.25+.3*(x/e.tuning.fullRadius)}const h=this.host.camera,c=this.pointScale||800,d=10*(e.echoFade/2.2);for(const x of this.moths){const m=e.moths.find(E=>E.id===x.id);if(x.group.visible=!m.collected,x.mark.visible=!1,m.collected){x.seenAt=-1/0;continue}const g=this.time+x.phase,v=Math.sin(g*22)*1;x.left.rotation.z=v,x.right.rotation.z=-v,x.group.position.set(x.baseX+Math.sin(g*.7)*.35,x.baseY+1+Math.sin(g*1.3)*.18+Math.sin(g*5.3)*.05,x.baseZ+Math.cos(g*.9)*.35),x.group.rotation.y=g*.6;const S=h?h.position.distanceTo(x.group.position):10;x.halo.scale.setScalar(Math.max(2.4,40*S/c)),x.halo.material.opacity=.72+Math.sin(g*3.1)*.12+Math.sin(g*22)*.08;for(const E of e.pulses){const b=x.baseX-E.x,A=x.baseY+1-E.y,y=x.baseZ-E.z,w=Math.hypot(b,A,y),C=E.time+w/e.tuning.pulseSpeed;if(w>E.radius||C>e.clock||C<=x.seenAt)continue;let R=!0;for(let I=1;I<12&&R;I++){const z=I/12;R=ha(this.terrain,E.x+b*z,E.y+A*z,E.z+y*z)}R&&(x.seenAt=C)}const _=e.clock-x.seenAt;if(_>=0&&_<d){const E=_/d,b=Math.max(0,1-_/.6);x.mark.visible=!0,x.mark.material.opacity=Math.min(1,.55*Math.pow(1-E,.8)*Math.min(1,_/.15)+.5*b),x.mark.scale.setScalar(Math.max(1.8,30*S/c)*(1+.5*(1-Math.min(1,_/.5))))}}for(const x of this.beasts){const m=e.beasts.find(A=>A.id===x.id);x.group.position.set(m.x,m.y,m.z);let g=m.facing-x.group.rotation.y;g=Math.atan2(Math.sin(g),Math.cos(g)),x.group.rotation.y+=g*(1-Math.exp(-t*8));const v=m.state==="sleeping"||m.state==="dormant",_=m.speed>1e-4?Math.min(1.2,m.speed/(t*3.1)):0;x.stride+=t*(2+_*9);const E=Math.sin(this.time*(v?1.3:3.2)+x.phase);x.torso.scale.set(1+E*.025,1+E*.05,1),x.rise+=((v?0:1)-x.rise)*(1-Math.exp(-t*4)),x.torso.position.y=(x.kind==="listener"?.72:.6)-(1-x.rise)*.22+Math.abs(Math.sin(x.stride))*.05*_,x.head.rotation.x=v?.35+E*.04:-.1+Math.sin(x.stride*2)*.06*_,x.head.position.y=(x.kind==="listener"?.82:.68)-(1-x.rise)*.3,x.legs.forEach((A,y)=>{A.rotation.x=Math.sin(x.stride+(y===0||y===3?0:Math.PI))*.55*_-(1-x.rise)*(y<2?-.8:.8)}),m.state==="searching"?x.head.rotation.y=Math.sin(this.time*2.5)*.6:x.head.rotation.y*=.9;const b=m.state==="rousing"?Math.sin(this.time*30)>0?1:0:1;x.eyes.visible=!v&&b>.5,x.eyes.children[2].material.opacity=m.state==="lunging"||m.state==="chasing"?1:.7}for(const x of this.crystals){const m=e.crystals.find(v=>v.id===x.id),g=Math.max(0,1-(e.clock-m.lastEcho)/1.2);x.mat.uniforms.uGlow.value=.15+g*.9,x.halo.material.opacity=.12+g*.8+Math.sin(this.time*1.5+x.group.position.x)*.04}e.checkpoints.forEach((x,m)=>{const g=this.checkpoints[m],v=m===e.checkpointIndex;g.crystal.rotation.y=this.time*(x.active?.8:.2),g.crystal.material.uniforms.uGlow.value=x.active?.5:.12,g.halo.material.opacity=v?.5+Math.sin(this.time*2)*.1:x.active?.2:.06});const u=e.exitOpen,f=this.exit;f.ring.material.opacity=u?.9:.12,f.ring.rotation.z=this.time*.5,f.rings.forEach((x,m)=>{const g=(this.time*.45+m/3)%1;x.position.y=.1+g*3.2,x.scale.setScalar(1-g*.45),x.material.opacity=u?Math.sin(g*Math.PI)*.9:0}),this.exitFlash=Math.max(0,this.exitFlash-t*.6);const p=.5+.5*Math.sin(this.time*2.2);f.beam.material.opacity=u?.26+p*.08+this.exitFlash*.4:0,f.halo.material.opacity=u?1:0,f.halo.scale.setScalar(u?7+p*1.2+this.exitFlash*6:5),f.beacon.material.opacity=u?.75+p*.15:0,f.beacon.scale.setScalar(u?2.6+p*.5:2.2),this.particles?.update(t,this.moths),this.bursts=this.bursts.filter(x=>{x.age+=t;const m=x.age/.9;return x.sprite.scale.setScalar(.5+x.size*m),x.sprite.material.opacity=Math.max(0,1-m),m>=1?(this.root.remove(x.sprite),x.sprite.material.dispose(),!1):!0})}}const t1=`
.eb-touch { position:absolute; inset:0; z-index:3; touch-action:none; user-select:none; -webkit-user-select:none; }
.eb-touch[hidden] { display:none; }
.eb-touch-on .a3game-hud-slot[data-a3game-anchor="top-right"] { top:70px; }
.eb-touch-on .a3game-hud-slot[data-a3game-anchor="bottom-right"] { bottom:72px; }
.eb-stick-base, .eb-stick-knob { position:absolute; border-radius:50%; pointer-events:none; transform:translate(-50%,-50%); }
.eb-stick-base { width:120px; height:120px; border:2px solid rgba(47,230,255,.45); background:rgba(47,230,255,.06); }
.eb-stick-knob { width:54px; height:54px; background:rgba(47,230,255,.35); border:2px solid rgba(220,250,255,.8); }
.eb-touch-hint { position:absolute; bottom:22px; font:12px "Avenir Next","Segoe UI",system-ui,sans-serif; letter-spacing:.12em;
  color:rgba(217,246,255,.45); text-transform:uppercase; pointer-events:none; }
.eb-touch-on .a3game-hud-slot[data-a3game-anchor="bottom-center"] { bottom:auto; top:25%; }
.eb-touch-on .a3game-hud-widget.eb-tip { margin-bottom:0; max-width:min(300px, 74vw); }
.eb-touch-hint { transition:opacity 1.5s ease; } .eb-touch-hint.gone { opacity:0; }
.eb-touch-hint.left { left:22px; } .eb-touch-hint.right { right:22px; text-align:right; }
.eb-touch-pause { position:absolute; top:12px; right:12px; width:48px; height:48px; border-radius:50%; pointer-events:auto;
  border:1px solid rgba(47,230,255,.6); background:rgba(0,0,0,.35); color:#fff; font-size:18px; letter-spacing:0; }
.eb-touch-view { position:absolute; top:12px; right:70px; width:48px; height:48px; border-radius:50%; pointer-events:auto;
  border:1px solid rgba(47,230,255,.4); background:rgba(0,0,0,.35); color:#fff; font:12px system-ui,sans-serif; }
.eb-pulse-ring { position:absolute; width:20px; height:20px; border-radius:50%; border:2px solid rgba(47,230,255,.8);
  transform:translate(-50%,-50%); pointer-events:none; }
`,Xr=55,e1=10,i1=.11;function n1(){try{return(globalThis.matchMedia?.("(pointer: coarse)").matches??!1)||(navigator.maxTouchPoints??0)>0}catch{return!1}}class s1{constructor({root:t,onLook:e,onPulseDown:i,onPulseUp:n,onPulseCancel:s,onPause:a,onView:o}){const l=document.createElement("style");l.textContent=t1,document.head.appendChild(l),this.el=document.createElement("div"),this.el.className="eb-touch",this.el.id="eb-touch",this.el.hidden=!0,this.el.innerHTML=`
      <div class="eb-touch-hint left">drag to move</div>
      <div class="eb-touch-hint right">drag look · tap pulse<br>hold loud</div>
      <button class="eb-touch-view" id="eb-touch-view" aria-label="Switch view">VIEW</button>
      <button class="eb-touch-pause" id="eb-touch-pause" aria-label="Pause">II</button>`,t.appendChild(this.el),this.base=document.createElement("div"),this.base.className="eb-stick-base",this.knob=document.createElement("div"),this.knob.className="eb-stick-knob",this.base.hidden=!0,this.knob.hidden=!0,this.el.append(this.base,this.knob),this.cb={onLook:e,onPulseDown:i,onPulseUp:n,onPulseCancel:s},this.move={x:0,y:0},this.stick=null,this.right=null,this.enabled=!1,this.visible=!1,this.captionT=0,this.el.querySelector("#eb-touch-pause").addEventListener("click",h=>{h.stopPropagation(),a()}),this.el.querySelector("#eb-touch-view").addEventListener("click",h=>{h.stopPropagation(),o()});for(const h of this.el.querySelectorAll("button"))h.addEventListener("pointerdown",c=>c.stopPropagation());this.el.addEventListener("pointerdown",h=>this.#i(h)),this.el.addEventListener("pointermove",h=>this.#s(h)),this.el.addEventListener("pointerup",h=>this.#n(h)),this.el.addEventListener("pointercancel",h=>this.#n(h,!0))}setEnabled(t){this.enabled=t,this.el.parentElement?.classList.toggle("eb-touch-on",t),this.#e()}setVisible(t){this.visible=t,t||this.reset(),this.#e()}showCaptions(){this.captionT=10;for(const t of this.el.querySelectorAll(".eb-touch-hint"))t.classList.remove("gone")}#e(){this.el.hidden=!(this.enabled&&this.visible)}reset(){this.move={x:0,y:0},this.stick=null,this.right?.mode==="charge"&&this.cb.onPulseCancel(),this.right=null,this.base.hidden=!0,this.knob.hidden=!0}#i(t){t.preventDefault(),this.el.setPointerCapture?.(t.pointerId);const e=this.el.getBoundingClientRect(),i=t.clientX-e.left,n=t.clientY-e.top;i<e.width/2&&!this.stick?(this.stick={id:t.pointerId,ox:i,oy:n},this.base.hidden=!1,this.knob.hidden=!1,this.base.style.left=`${i}px`,this.base.style.top=`${n}px`,this.knob.style.left=`${i}px`,this.knob.style.top=`${n}px`,this.move={x:0,y:0}):i>=e.width/2&&!this.right&&(this.right={id:t.pointerId,sx:i,sy:n,lx:i,ly:n,t:0,mode:"pending"})}#s(t){const e=this.el.getBoundingClientRect(),i=t.clientX-e.left,n=t.clientY-e.top;if(this.stick?.id===t.pointerId){let s=i-this.stick.ox,a=n-this.stick.oy;const o=Math.hypot(s,a);o>Xr&&(s*=Xr/o,a*=Xr/o),this.knob.style.left=`${this.stick.ox+s}px`,this.knob.style.top=`${this.stick.oy+a}px`,this.move={x:s/Xr,y:-a/Xr}}else if(this.right?.id===t.pointerId){const s=this.right;s.mode!=="look"&&Math.hypot(i-s.sx,n-s.sy)>e1&&(s.mode==="charge"&&this.cb.onPulseCancel(),s.mode="look"),s.mode==="look"&&this.cb.onLook(i-s.lx,n-s.ly),s.lx=i,s.ly=n}}#n(t,e=!1){if(this.stick?.id===t.pointerId)this.stick=null,this.move={x:0,y:0},this.base.hidden=!0,this.knob.hidden=!0;else if(this.right?.id===t.pointerId){const i=this.right;if(this.right=null,e){i.mode==="charge"&&this.cb.onPulseCancel();return}i.mode==="charge"?this.cb.onPulseUp():i.mode==="pending"&&(this.cb.onPulseDown(),this.cb.onPulseUp(),this.#a(i.sx,i.sy))}}#a(t,e){const i=document.createElement("div");i.className="eb-pulse-ring",i.style.left=`${t}px`,i.style.top=`${e}px`,this.el.appendChild(i),i.animate?.([{width:"20px",height:"20px",opacity:1},{width:"140px",height:"140px",opacity:0}],{duration:450}),setTimeout(()=>i.remove(),460)}update(t){if(this.captionT>0&&this.visible&&(this.captionT-=t,this.captionT<=0))for(const i of this.el.querySelectorAll(".eb-touch-hint"))i.classList.add("gone");const e=this.right;e&&e.mode==="pending"&&(e.t+=t,e.t>=i1&&(e.mode="charge",this.cb.onPulseDown()))}}const An=5,r1=new Set([".","~","S","C","c","e","M","B","L","G","*","E"]);function xf(r,t,e){const i=Math.sin(r*127.1+t*311.7+e*74.7)*43758.5453;return i-Math.floor(i)}function a1(r,t,e=Math.min(2,globalThis.devicePixelRatio||1)){const i=t.rows,n=i.length,s=Math.max(...i.map(y=>y.length)),a=(y,w)=>w>=0&&w<n&&y>=0&&y<i[w].length&&r1.has(i[w][y]);let o=s,l=0,h=n,c=0;for(let y=0;y<n;y+=1)for(let w=0;w<s;w+=1)a(w,y)&&(o=Math.min(o,w),l=Math.max(l,w),h=Math.min(h,y),c=Math.max(c,y));const d=2;o=Math.max(0,o-d),h=Math.max(0,h-d),l=Math.min(s-1,l+d),c=Math.min(n-1,c+d);const u=l-o+1,f=c-h+1,p=u*An,x=f*An;r.width=Math.round(p*e),r.height=Math.round(x*e),r.dataset.aspect=String(p/x),r.style.aspectRatio=`${p} / ${x}`;const m=r.getContext("2d");if(!m)return;m.scale(e,e);const g=y=>(y-o)*An,v=y=>(y-h)*An;m.fillStyle="#02070b",m.fillRect(0,0,p,x);for(let y=h;y<=c;y+=1)for(let w=o;w<=l;w+=1)a(w,y)&&(m.fillStyle=i[y][w]==="~"?"rgba(40,110,200,.20)":"rgba(47,230,255,.055)",m.fillRect(g(w),v(y),An+.5,An+.5));const S=[],_=(y,w,C)=>[g(y)+(xf(y,w,C)-.5)*1.6,v(w)+(xf(y,w,C+5)-.5)*1.6];for(let y=h;y<=c;y+=1)for(let w=o;w<=l;w+=1)a(w,y)&&(a(w,y-1)||S.push([_(w,y,1),_(w+1,y,1),0,1]),a(w,y+1)||S.push([_(w,y+1,1),_(w+1,y+1,1),0,-1]),a(w-1,y)||S.push([_(w,y,1),_(w,y+1,1),1,0]),a(w+1,y)||S.push([_(w+1,y,1),_(w+1,y+1,1),-1,0]));const E=(y,w,C,R)=>{m.save(),m.lineWidth=w,m.strokeStyle=C,m.lineCap="round",R&&(m.shadowColor="rgba(47,230,255,.9)",m.shadowBlur=R),m.beginPath();for(const[I,z,G,L]of S)m.moveTo(I[0]+G*y,I[1]+L*y),m.lineTo(z[0]+G*y,z[1]+L*y);m.stroke(),m.restore()};E(1.6,.6,"rgba(47,230,255,.22)",0),E(0,.9,"rgba(120,235,255,.7)",3);const b=(y,w)=>[g(y)+An/2,v(w)+An/2];for(let y=h;y<=c;y+=1)for(let w=o;w<=l;w+=1){const C=i[y][w];if(C==="M"){const[R,I]=b(w,y),z=m.createRadialGradient(R,I,0,R,I,7);z.addColorStop(0,"rgba(255,176,58,.55)"),z.addColorStop(1,"rgba(255,176,58,0)"),m.fillStyle=z,m.fillRect(R-7,I-7,14,14),m.fillStyle="#ffb03a",m.beginPath(),m.arc(R,I,2.1,0,Math.PI*2),m.fill()}else if(C==="E"){const[R,I]=b(w,y);m.strokeStyle="#d9f6ff",m.lineWidth=1.2,m.shadowColor="#bfefff",m.shadowBlur=5,m.beginPath(),m.arc(R,I,3.6,0,Math.PI*2),m.stroke(),m.beginPath(),m.moveTo(R-1.8,I),m.lineTo(R+1.8,I),m.moveTo(R,I-1.8),m.lineTo(R,I+1.8),m.stroke(),m.shadowBlur=0}else if(C==="S"){const[R,I]=b(w,y);m.strokeStyle="rgba(217,246,255,.9)",m.lineWidth=1.2,m.beginPath(),m.moveTo(R,I-3.6),m.lineTo(R,I+3.6),m.moveTo(R-2.4,I+3.6),m.lineTo(R+2.4,I+3.6),m.stroke()}}const A=m.createRadialGradient(p/2,x/2,Math.min(p,x)*.35,p/2,x/2,Math.max(p,x)*.75);A.addColorStop(0,"rgba(2,7,11,0)"),A.addColorStop(1,"rgba(2,7,11,.85)"),m.fillStyle=A,m.fillRect(0,0,p,x)}const o1=`
:root { --cyan:#2fe6ff; --amber:#ffb03a; --red:#ff3b3b; --ink:#d9f6ff; }
.eb-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; overflow:auto;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif; color:var(--ink); z-index:5; touch-action:manipulation; }
.eb-overlay[hidden] { display:none; }
.eb-screen { position:relative; text-align:center; max-width:760px; width:100%; padding:24px 16px; box-sizing:border-box; margin:auto; }
.eb-title { font-size:clamp(26px, 6vw, 56px); font-weight:200; letter-spacing:.22em; margin:0 0 12px; padding-left:.22em;
  color:#fff; text-shadow:0 0 18px rgba(47,230,255,.7), 0 0 2px #fff; }
.eb-sub { color:rgba(217,246,255,.72); font-size:15px; letter-spacing:.06em; margin:0 auto 24px; line-height:1.6; max-width:560px; }
.eb-keys { display:grid; grid-template-columns:auto auto; gap:6px 18px; justify-content:center; text-align:left;
  font-size:14px; color:rgba(217,246,255,.82); margin:0 auto 24px; }
.eb-keys b { color:var(--cyan); font-weight:600; text-align:right; }
.eb-btn { pointer-events:auto; background:transparent; color:#fff; border:1px solid rgba(47,230,255,.6);
  padding:12px 26px; min-height:44px; font:inherit; font-size:14px; letter-spacing:.18em; text-transform:uppercase; cursor:pointer;
  border-radius:999px; box-shadow:0 0 16px rgba(47,230,255,.25) inset; margin:4px; }
.eb-btn:hover, .eb-btn:focus-visible { background:rgba(47,230,255,.16); box-shadow:0 0 22px rgba(47,230,255,.35) inset, 0 0 14px rgba(47,230,255,.2); outline:none; }
.eb-btn:focus-visible { outline:2px solid var(--cyan); outline-offset:3px; }
.eb-btn, .eb-seg { transition:background .15s ease, box-shadow .15s ease; }
.eb-seg button:focus-visible { outline:2px solid var(--cyan); outline-offset:-2px; }
.eb-btn[disabled] { opacity:.35; cursor:default; }
.eb-seg { display:inline-flex; border:1px solid rgba(47,230,255,.5); border-radius:999px; padding:3px; margin:0 0 22px; }
.eb-seg button { background:none; border:0; color:rgba(217,246,255,.7); font:inherit; font-size:13px; letter-spacing:.16em;
  text-transform:uppercase; padding:9px 16px; min-height:40px; border-radius:999px; cursor:pointer; }
.eb-seg button[aria-pressed="true"] { background:rgba(47,230,255,.22); color:#fff; }
.eb-hint { margin-top:14px; font-size:12px; color:rgba(217,246,255,.45); letter-spacing:.1em; }
.eb-dim { background:rgba(0,0,0,.74); }
.eb-black { background:#000; }
.eb-caught { background:radial-gradient(ellipse at center, rgba(60,0,0,.55), rgba(0,0,0,.92)); }
.eb-caught .eb-title { color:#ffd9d9; text-shadow:0 0 18px rgba(255,40,40,.8); }
.eb-surface { background:radial-gradient(ellipse at 50% 20%, #1d3a52 0%, #071019 55%, #000 100%); }
.eb-stats { display:grid; grid-template-columns:auto auto; gap:8px 28px; justify-content:center; font-size:16px; margin:0 0 22px; }
.eb-stats span:nth-child(odd) { text-align:right; color:rgba(217,246,255,.6); }
.eb-stats span:nth-child(even) { text-align:left; color:#fff; font-variant-numeric:tabular-nums; }
.eb-stars { font-size:44px; letter-spacing:.2em; margin:0 0 6px; color:rgba(255,255,255,.18); }
.eb-stars i { font-style:normal; color:var(--amber); text-shadow:0 0 14px rgba(255,176,58,.8); }
.eb-checks { list-style:none; padding:0; margin:0 auto 20px; font-size:14px; color:rgba(217,246,255,.7); display:inline-block; text-align:left; }
.eb-checks li::before { content:'\\2022'; margin-right:8px; color:rgba(255,255,255,.3); }
.eb-checks li.ok::before { content:'\\2713'; color:var(--amber); }
.eb-new { color:var(--amber); font-size:12px; letter-spacing:.14em; text-transform:uppercase; margin-left:6px; }
.eb-levels { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; margin:0 0 18px; text-align:left; }
.eb-card { position:relative; pointer-events:auto; display:flex; flex-direction:column; gap:10px; text-align:left; color:#fff; font:inherit; cursor:pointer;
  background:linear-gradient(180deg, rgba(47,230,255,.07), rgba(47,230,255,.02)); border:1px solid rgba(47,230,255,.32);
  border-radius:16px; padding:12px 12px 14px; transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease; }
.eb-card:hover, .eb-card:focus-visible { transform:translateY(-3px); border-color:rgba(120,240,255,.85); background:linear-gradient(180deg, rgba(47,230,255,.14), rgba(47,230,255,.04));
  box-shadow:0 8px 28px rgba(47,230,255,.22), 0 0 0 1px rgba(47,230,255,.25); outline:none; }
.eb-card:focus-visible { box-shadow:0 0 0 3px #02070b, 0 0 0 5px var(--cyan), 0 8px 28px rgba(47,230,255,.3); }
.eb-card[disabled] { cursor:default; opacity:.5; transform:none; box-shadow:none; border-color:rgba(47,230,255,.16); background:rgba(47,230,255,.02); }
.eb-card[disabled] .eb-prev { filter:grayscale(.6) brightness(.55); }
.eb-prev { position:relative; border-radius:10px; overflow:hidden; background:#02070b; border:1px solid rgba(47,230,255,.15); }
.eb-prev canvas { display:block; width:100%; height:auto; max-height:112px; object-fit:contain; margin:0 auto; }
.eb-lock { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(217,246,255,.9); background:rgba(0,6,10,.35); }
.eb-lock svg { width:34px; height:34px; filter:drop-shadow(0 0 8px rgba(47,230,255,.6)); }
.eb-card h3 { margin:0; font-size:18px; font-weight:500; letter-spacing:.06em; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.eb-card h3 .st { font-size:15px; letter-spacing:.12em; white-space:nowrap; }
.eb-card p { margin:0; font-size:13px; color:rgba(217,246,255,.72); line-height:1.45; }
.eb-card .rec { font-size:12.5px; color:rgba(217,246,255,.85); font-variant-numeric:tabular-nums; display:grid; grid-template-columns:auto 1fr; gap:3px 12px; margin-top:auto; }
.eb-card .rec span:nth-child(odd) { color:rgba(217,246,255,.5); letter-spacing:.08em; text-transform:uppercase; font-size:11px; align-self:center; }
.eb-card .st { color:rgba(255,255,255,.22); }
.eb-card .st i { font-style:normal; color:var(--amber); text-shadow:0 0 10px rgba(255,176,58,.7); }
.eb-card .lockline { font-size:13px; color:rgba(217,246,255,.7); margin-top:auto; }
.eb-title-screen { align-items:flex-start; background:none; }
.eb-title-screen::before { content:''; position:absolute; inset:0 0 auto 0; height:78%; pointer-events:none;
  background:linear-gradient(180deg, rgba(0,3,6,.9) 0%, rgba(0,3,6,.74) 45%, rgba(0,3,6,.28) 82%, rgba(0,3,6,0) 100%); }
.eb-title-screen .eb-screen { padding-top:clamp(28px, 8vh, 84px); }
.eb-title-screen .eb-title { font-size:clamp(30px, 5.4vw, 66px); font-weight:200; margin-bottom:6px;
  text-shadow:0 0 28px rgba(47,230,255,.65), 0 0 10px rgba(47,230,255,.45), 0 0 1px #fff; }
.eb-tagline { font-size:12px; letter-spacing:.42em; text-transform:uppercase; color:rgba(47,230,255,.85); margin:0 0 18px; padding-left:.42em; }
.eb-title-screen .eb-sub { text-shadow:0 1px 8px #000; margin-bottom:18px; }
.eb-ctrl-line { font-size:12px; color:rgba(217,246,255,.6); letter-spacing:.08em; margin:0 auto 16px; text-shadow:0 1px 6px #000; }
.eb-title-screen .eb-hint { color:rgba(217,246,255,.6); text-shadow:0 1px 6px #000; }
@media (max-width: 640px) {
  .eb-levels { grid-template-columns:1fr; gap:12px; }
  .eb-card { flex-direction:row; flex-wrap:wrap; }
  .eb-card .eb-prev { flex:0 0 100%; }
  .eb-title-screen::before { height:92%; }
}
@media (prefers-reduced-motion: reduce) { .eb-card { transition:none; transform:none !important; } }
.eb-rings { position:absolute; left:50%; top:50%; pointer-events:none; }
.eb-rings i { position:absolute; left:0; top:0; width:10px; height:10px; margin:-5px; border-radius:50%;
  border:1px solid rgba(47,230,255,.45); animation:eb-ring 4.5s linear infinite; }
.eb-rings i:nth-child(2) { animation-delay:1.5s; } .eb-rings i:nth-child(3) { animation-delay:3s; }
@keyframes eb-ring { from { width:10px; height:10px; margin:-5px; opacity:.9; } to { width:1400px; height:1400px; margin:-700px; opacity:0; } }
@media (prefers-reduced-motion: reduce) { .eb-rings i { animation:none; opacity:.15; width:500px; height:500px; margin:-250px; } }
.a3game-hud-widget.eb-hud { font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif; letter-spacing:.08em; font-size:15px; color:var(--ink); }
.a3game-hud-widget.eb-moths { color:var(--amber); font-size:17px; }
.a3game-hud-widget.eb-level { font-size:12px; color:rgba(217,246,255,.55); letter-spacing:.14em; text-transform:uppercase; }
.a3game-hud-widget.eb-help { font-size:13px; color:rgba(217,246,255,.55); }
.a3game-hud-widget.eb-noise { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:rgba(217,246,255,.5); transition:color .3s ease, opacity .3s ease; }
.a3game-hud-widget.eb-noise.eb-n-quiet { color:rgba(70,220,205,.75); }
.a3game-hud-widget.eb-noise.eb-n-walking { color:rgba(255,176,58,.8); }
.a3game-hud-widget.eb-noise.eb-n-loud { color:rgba(255,80,70,.9); }
.eb-controls { margin:18px auto 6px; padding:14px 18px 10px; max-width:420px; border:1px solid rgba(47,230,255,.25); border-radius:12px; background:rgba(0,10,16,.4); }
.eb-controls h2 { margin:0 0 10px; font-size:12px; font-weight:400; letter-spacing:.24em; text-transform:uppercase; color:rgba(217,246,255,.6); }
.eb-controls .eb-keys { margin:0 auto 6px; font-size:13px; }
.a3game-hud-widget.eb-toast { font-size:16px; color:#fff; letter-spacing:.14em; text-transform:uppercase; text-align:center;
  text-shadow:0 0 12px rgba(47,230,255,.8); margin-top:12vh; }
.a3game-hud-widget.eb-tip { font-size:15px; color:#fff; max-width:min(560px, 86vw); text-align:center; padding:10px 16px; margin-bottom:9vh;
  border-radius:10px; background:rgba(0,10,16,.55); border:1px solid rgba(47,230,255,.3); }
.eb-vignette { position:absolute; inset:0; pointer-events:none; opacity:0;
  background:radial-gradient(ellipse at center, transparent 42%, rgba(150,0,0,.35) 72%, rgba(255,20,20,.62)); z-index:4; }
.eb-intro .eb-screen { max-width:640px; }
.eb-intro-line { font-size:clamp(16px, 2.6vw, 22px); font-weight:300; letter-spacing:.06em; line-height:1.6; color:#e8fbff;
  margin:0 0 18px; opacity:0; animation:eb-intro-in 1.6s ease forwards; text-shadow:0 0 14px rgba(47,230,255,.45); }
@keyframes eb-intro-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
.eb-intro .eb-rings i { animation-duration:6s; border-color:rgba(47,230,255,.3); }
.eb-intro .eb-rings i:nth-child(2) { animation-delay:2s; } .eb-intro .eb-rings i:nth-child(3) { animation-delay:4s; }
.eb-intro .eb-hint { opacity:0; animation:eb-intro-in 1s ease 1.2s forwards; }
@media (prefers-reduced-motion: reduce) { .eb-intro-line, .eb-intro .eb-hint { animation:none; opacity:1; } }
@media (max-width: 600px) { .a3game-hud-widget.eb-help { display:none; } .eb-stars { font-size:36px; } }
`;function Js(r){const t=Math.floor(r/60),e=Math.floor(r%60);return`${t}:${String(e).padStart(2,"0")}`}const l1=r=>`${"<i>★</i>".repeat(r)}${"★".repeat(3-r)}`;class h1{constructor({root:t,hud:e,commands:i,touch:n=!1}){this.hud=e,this.commands=i,this.touch=n;const s=document.createElement("style");s.textContent=o1,document.head.appendChild(s),this.vignette=document.createElement("div"),this.vignette.className="eb-vignette",t.appendChild(this.vignette),this.overlay=document.createElement("div"),this.overlay.className="eb-overlay",this.overlay.id="eb-overlay",t.appendChild(this.overlay),this.overlay.addEventListener("click",a=>{const o=a.target.closest("[data-cmd]");!o||o.disabled||this.commands[o.dataset.cmd]?.(o.dataset.arg)}),e.addText("moths",{anchor:"top-left",value:"",className:"eb-hud eb-moths"}),e.addText("level",{anchor:"top-left",value:"",className:"eb-hud eb-level"}),e.addText("timer",{anchor:"top-right",value:"",className:"eb-hud"}),e.addText("toast",{anchor:"top-center",value:"",className:"eb-hud eb-toast"}),e.addText("tip",{anchor:"bottom-center",value:"",className:"eb-hud eb-tip"}),e.addText("noise",{anchor:"bottom-right",value:"",className:"eb-hud eb-noise"}),e.addText("help",{anchor:"bottom-left",value:`Tap Space / click: quiet pulse   Hold: loud pulse
WASD move  ·  mouse / arrows look  ·  Shift sneak
V view  ·  Esc pause`,className:"eb-hud eb-help"}),e.setVisible("tip",!1),e.setVisible("help",!n),this.helpEl=e.root.querySelector(".eb-help"),this.noiseEl=e.root.querySelector(".eb-noise"),this.help={t:0,min:0,max:0,wait:!1,base:null},this.showHelp(0),this.toastTime=0,this.tipTime=0,this.tipQueue=[],this.screen=null}setTouch(t){this.touch=t,this.hud.setVisible("help",!t&&this.helpShown)}showHelp(t){const e=this.help;e.t=0,e.fade=-1,e.wait=!1,e.min=e.max=t,this.helpShown=t>0,this.touch||this.hud.setVisible("help",this.helpShown)}beginHelp(t,e){if(this.showHelp(8),t==="hollow"){const i=this.help;i.wait=!0,i.min=6,i.max=25,i.base={x:e.player.x,z:e.player.z}}}#e(t,e){const i=this.help;if(!this.helpShown||this.touch)return;if(i.fade>=0){i.fade+=t/1.5,i.fade>=1?(this.helpShown=!1,this.hud.setVisible("help",!1)):this.helpEl.style.opacity=String(1-i.fade);return}i.t+=t;let n=i.t>=i.max;!n&&i.wait&&i.t>=i.min&&i.base&&(n=Math.hypot(e.player.x-i.base.x,e.player.z-i.base.z)>=.5&&e.stats.tapPulses>0&&e.stats.fullPulses>0),n&&(i.fade=0)}#i(t){const e=t.noise;if(e<=0)return null;const i=t.player,n=nr[t.difficulty].hearing,s=(a,o)=>t.beasts.some(l=>l.state==="sleeping"&&l.kind!=="great"&&(!o||l.kind==="listener")&&Math.hypot(l.x-i.x,l.y-i.y,l.z-i.z)<=a*n);return i.inWater?{word:"splashing",dots:"●●●",cls:s(e>=.9?Co.wadeRadius:Co.wadeSneakRadius,!1)?"loud":"walking"}:e<.3?{word:"quiet",dots:"●○○",cls:"quiet"}:s(Co.footstepRadius,!0)?{word:"loud",dots:"●●●",cls:"loud"}:{word:"walking",dots:"●●○",cls:"walking"}}#s(t,e,i){this.screen=i,this.overlay.className=`eb-overlay ${t}`,this.overlay.innerHTML=e,this.overlay.hidden=!1,this.overlay.scrollTop=0,this.overlay.querySelector("[data-focus]")?.focus({preventScroll:!0}),this.hud.root.style.visibility="hidden"}hideScreens(){this.overlay.hidden=!0,this.overlay.innerHTML="",this.screen=null,this.hud.root.style.visibility=""}#n(t){return`<div class="eb-seg" role="group" aria-label="Difficulty">${lf.map(e=>`
      <button data-cmd="setDifficulty" data-arg="${e}" id="eb-diff-${e}" aria-pressed="${e===t}">${nr[e].label}</button>`).join("")}</div>`}showTitle(t){const e=this.touch?"Drag to move  ·  tap to pulse  ·  hold for a loud pulse":"WASD move  ·  Space or click: pulse (hold for loud)  ·  Shift sneak";this.#s("eb-title-screen",`
      <div class="eb-screen" data-screen="title">
        <h1 class="eb-title">ECHOES BELOW</h1>
        <p class="eb-tagline">a cave seen through sound</p>
        <p class="eb-sub">You are small, and blind, and the cave is black. Call into the dark and the rock answers.
        Gather the glow-moths to wake the way up. Something else sleeps down here. Keep it quiet.</p>
        <div class="eb-ctrl-line">${e}</div>
        ${this.#n(t.difficulty)}<br>
        <button class="eb-btn" data-cmd="openSelect" id="eb-start" data-focus>Descend</button>
        <div class="eb-hint">Headphones help: you can hear where things are.</div>
      </div>`,"title")}showIntro(t,e){this.#s("eb-black eb-intro",`
      <div class="eb-rings"><i></i><i></i><i></i></div>
      <div class="eb-screen" data-screen="intro">
        ${t.map((o,l)=>`<p class="eb-intro-line" style="animation-delay:${(.4+l*2.4).toFixed(1)}s">${o}</p>`).join("")}
        <div class="eb-hint">${this.touch?"Tap to skip":"Press any key to skip"}</div>
      </div>`,"intro");let n=!1;const s=()=>{n||(n=!0,clearTimeout(a),window.removeEventListener("keydown",s,!0),window.removeEventListener("pointerdown",s,!0),e())},a=setTimeout(s,(.4+t.length*2.4+2.6)*1e3);setTimeout(()=>{n||(window.addEventListener("keydown",s,!0),window.addEventListener("pointerdown",s,!0))},250)}setDifficulty(t){for(const e of lf)this.overlay.querySelector(`#eb-diff-${e}`)?.setAttribute("aria-pressed",String(e===t))}showSelect(t){const e=t.difficulty,i='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',n=de.map((s,a)=>{const o=a<t.unlocked,l=t.records[s.id]?.[e],h=bp(s,e),c=l?.stars??0,d=`<span class="st" aria-label="${c} of 3 stars">${"<i>★</i>".repeat(c)}${"★".repeat(3-c)}</span>`,u=o?`<p>${s.blurb}</p>
           <div class="rec">
             <span>Par</span><span>${Js(h.time)} · ${h.pulses} pulses</span>
             <span>Best</span><span>${l?`${Js(l.bestTime)} · ${l.fewestPulses} pulses`:"--"}</span>
           </div>`:`<p>${s.blurb}</p><div class="lockline">Finish ${de[a-1].name} to unlock</div>`;return`<button class="eb-card" data-cmd="play" data-arg="${s.id}" id="eb-level-${s.id}" ${o?"":'disabled aria-disabled="true"'} ${o&&!l?"data-focus":""}>
        <div class="eb-prev"><canvas data-level="${s.id}" aria-hidden="true"></canvas>${o?"":`<div class="eb-lock">${i}</div>`}</div>
        <h3><span>${a+1}. ${s.name}</span>${d}</h3>${u}</button>`}).join("");this.#s("eb-black",`
      <div class="eb-screen" data-screen="select" style="max-width:900px">
        <h1 class="eb-title" style="font-size:clamp(24px,5vw,40px)">THE CAVES</h1>
        ${this.#n(e)}
        <div class="eb-levels" style="margin-top:18px">${n}</div>
        <button class="eb-btn" data-cmd="openTitle">Back</button>
      </div>`,"select");for(const s of this.overlay.querySelectorAll("canvas[data-level]"))a1(s,de.find(a=>a.id===s.dataset.level));this.overlay.querySelector("[data-focus]")||this.overlay.querySelector(".eb-card:not([disabled])")?.focus({preventScroll:!0})}showPause(t){this.#s("eb-dim",`
      <div class="eb-screen" data-screen="paused">
        <h1 class="eb-title" style="font-size:44px">PAUSED</h1>
        <p class="eb-sub">The dark waits.</p>
        <div class="eb-controls" id="eb-controls"><h2>Controls</h2><div class="eb-keys">${this.touch?"<b>left side</b><span>drag to move (gently to sneak)</span><b>right side</b><span>drag to look</span><b>tap right</b><span>quiet pulse</span><b>hold right</b><span>loud pulse</span>":"<b>WASD</b><span>move</span><b>Shift</b><span>sneak</span><b>mouse / arrows</b><span>look</span><b>tap Space / click</b><span>quiet pulse</span><b>hold Space</b><span>loud pulse</span><b>V</b><span>view</span><b>H / ?</b><span>show controls</span><b>Esc</b><span>pause</span>"}</div></div>
        <button class="eb-btn" data-cmd="resume" data-focus>Resume</button>
        <button class="eb-btn" data-cmd="restart">Restart cave</button>
        <button class="eb-btn" data-cmd="openSelect">Caves</button>
        <button class="eb-btn" data-cmd="toggleMute" id="eb-mute">Sound: ${t?"off":"on"}</button>
        <div class="eb-hint">${this.touch?"Tap Resume to carry on":"Esc to resume"}</div>
      </div>`,"paused")}setMuteLabel(t){const e=this.overlay.querySelector("#eb-mute");e&&(e.textContent=`Sound: ${t?"off":"on"}`)}showCaught(t){this.#s("eb-caught",`
      <div class="eb-screen" data-screen="caught">
        <h1 class="eb-title">CAUGHT</h1>
        <p class="eb-sub">${t?"It was faster in the dark. Climb harder.":"Something in the dark heard you."}</p>
        <button class="eb-btn" data-cmd="respawn" id="eb-respawn" data-focus>Wake at the last crystal</button>
        <div class="eb-hint">${this.touch?"Your moths stay with you.":"Enter or Space. Your moths stay with you."}</div>
      </div>`,"caught")}showResults({def:t,result:e,stars:i,checks:n,par:s,record:a,isBestTime:o,isFewestPulses:l,unlockedNew:h,last:c}){const d=de[de.findIndex(f=>f.id===t.id)+1],u=c?'<button class="eb-btn" data-cmd="openEnding" id="eb-next" data-focus>Surface</button>':`<button class="eb-btn" data-cmd="play" data-arg="${d.id}" id="eb-next" data-focus>Next: ${d.name}</button>`;this.#s("eb-black",`
      <div class="eb-screen" data-screen="results">
        <h1 class="eb-title" style="font-size:clamp(24px,5vw,42px)">${t.name.toUpperCase()}</h1>
        <div class="eb-stars" id="eb-stars" data-stars="${i}">${l1(i)}</div>
        <ul class="eb-checks">
          <li class="${n.time?"ok":""}">under ${Js(s.time)}</li>
          <li class="${n.pulses?"ok":""}">${s.pulses} pulses or fewer</li>
          <li class="${n.uncaught?"ok":""}">never caught</li>
        </ul>
        <div class="eb-stats">
          <span>Time</span><span id="eb-res-time">${Js(e.time)}${o?'<span class="eb-new">best</span>':""}</span>
          <span>Pulses</span><span id="eb-res-pulses">${e.pulses} (${e.tapPulses} quiet, ${e.fullPulses} loud)${l?'<span class="eb-new">fewest</span>':""}</span>
          <span>Caught</span><span>${e.deaths} ${e.deaths===1?"time":"times"}</span>
          <span>Best</span><span>${Js(a.bestTime)} · ${a.fewestPulses} pulses</span>
        </div>
        ${h&&!c?`<p class="eb-sub">${h.name} is open.</p>`:""}
        ${u}
        <button class="eb-btn" data-cmd="restart">Again</button>
        <button class="eb-btn" data-cmd="openSelect">Caves</button>
      </div>`,"results")}showEnding(t){this.#s("eb-surface",`
      <div class="eb-screen" data-screen="ending">
        <h1 class="eb-title" style="font-size:clamp(28px,6vw,54px)">SURFACED</h1>
        <p class="eb-sub">Wind. Cold air that goes on forever. Above you the dark is full of tiny lights,
        and none of them are moths. You call once, loud, and nothing answers. Nothing needs to.</p>
        <div class="eb-stats">
          <span>Caves</span><span>${t.levels} of ${de.length}</span>
          <span>Stars</span><span id="eb-total-stars">${t.stars} of ${de.length*3}</span>
          <span>Difficulty</span><span>${nr[t.difficulty].label}</span>
        </div>
        <button class="eb-btn" data-cmd="openTitle" id="eb-end-title" data-focus>Back to the dark</button>
      </div>`,"ending")}toast(t,e=2.2){this.hud.setValue("toast",t),this.hud.setVisible("toast",!0),this.toastTime=e}tip(t){this.tipQueue.push(t),this.tipTime<=0&&this.#a()}currentTipIs(t){return!!t&&this.hud.root.querySelector(".eb-tip")?.textContent===t}endTip(){this.tipTime=.001}#a(){const t=this.tipQueue.shift();if(!t){this.hud.setVisible("tip",!1),this.tipTime=0;return}this.hud.setValue("tip",t),this.hud.setVisible("tip",!0),this.tipTime=Math.max(3.5,t.length*.07)}clearTips(){this.tipQueue=[],this.tipTime=0,this.hud.setVisible("tip",!1),this.hud.setVisible("toast",!1)}flashDanger(t){this.vignette.style.opacity=String(t)}update(t,e,i){this.hud.setValue("moths",`Glow-moths  ${e.mothsCollected} / ${e.mothsRequired}${e.exit.open?"   -  the way out is open":""}`),this.hud.setValue("level",`${i}  ·  ${nr[e.difficulty].label}`),this.hud.setValue("timer",`${Js(e.runTime)}    pulses ${e.stats.pulses}`);const n=this.#i(e);this.hud.setValue("noise",n?`${n.dots} ${n.word}`:""),this.noiseEl?.classList.remove("eb-n-quiet","eb-n-walking","eb-n-loud"),n&&this.noiseEl?.classList.add(`eb-n-${n.cls}`),e.phase==="playing"&&this.#e(t,e),this.toastTime>0&&(this.toastTime-=t,this.toastTime<=0&&this.hud.setVisible("toast",!1)),this.tipTime>0&&(this.tipTime-=t,this.tipTime<=0&&this.#a())}}const c1=2.4,yf=.0024,Cp="echoes-below:intro:v1",u1=["You hatched in the dark, too far down for any light to reach.","You have no eyes. You have a voice, and the rock answers it.","The glow-moths know the way up. Gather them, and the way out wakes.","Something else lives down here. It listens too."];function d1(){let r="high";try{r=globalThis.window?.patch?.quality??"high"}catch{}return r==="low"||r==="medium"?r:"high"}const f1=()=>{try{return globalThis.localStorage?.getItem(Cp)==="1"}catch{return!1}},p1=()=>{try{globalThis.localStorage?.setItem(Cp,"1")}catch{}};async function m1({viewport:r="#a3game-viewport",hudContainer:t="#a3game-hud"}={}){const e=d1(),i=e==="high",n=new Hv({container:r,hudContainer:t,antialias:!0,shadows:!1,clearColor:0,pixelRatioCap:{high:2,medium:1.25,low:1}[e],toneMapping:"NoToneMapping",fov:68,near:.05,far:140,fixedTimeStep:1/60});await n.init();const s=i?HM(n.renderer,n.scene):null,a=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches??!1;let o=gb();const l=new Mb({level:de[0],difficulty:o.difficulty});let h=new gf(n,l,{particles:i});const c=new fb(n.camera,{reducedMotion:a}),d=new Qv,u=new $v({container:n.hudContainer});let f=n1(),p=new af(l.def,{touch:f});const x=n.container.parentElement??document.body;let m=0,g=null;const v=U=>{const at=pb(U);(l.def!==at||l.difficultyId!==o.difficulty||!h)&&(l.setLevel(at,o.difficulty),h.dispose(),h=new gf(n,l,{particles:i}),h.setFirstPerson(c.mode==="first")),p=new af(l.def,{touch:f})},S=new jv({host:n,rules:l,quality:e,reducedMotion:a,getScene:()=>h,touch:()=>f,prepare:()=>v(de[0].id),restore:U=>{U.setFirstPerson(c.mode==="first"),U.creature.setFade(1)}}),_=()=>{d.unlock(),d.stopAll(),l.restart(),c.snap(l.player.facing),h.playerY=l.player.y,h.snapFacing(),p.reset(),A.clearTips(),A.hideScreens(),y.setVisible(!0),y.showCaptions(),A.beginHelp(l.def.id,l.getState()),A.toast(l.def.name,2.5)},E=U=>{y.setVisible(!1),d.stopAll(),document.pointerLockElement&&document.exitPointerLock?.(),U()},b={openTitle:()=>E(()=>{l.phase=Ht.TITLE,A.showTitle(o)}),openSelect:()=>E(()=>{d.unlock(),l.phase=Ht.TITLE,A.showSelect(o)}),setDifficulty:U=>{o={...o,difficulty:U},of(o),A.screen==="select"?A.showSelect(o):A.setDifficulty(U)},play:U=>{if(U===de[0].id&&!f1()){p1(),d.unlock(),A.showIntro(u1,()=>{A.screen==="intro"&&(v(U),_())});return}v(U),_()},start:()=>_(),restart:()=>_(),resume:()=>{l.resume()&&(A.hideScreens(),y.setVisible(!0))},pause:()=>{l.pause()&&(m=performance.now(),d.stopCharge(),y.setVisible(!1),A.showPause(d.muted))},togglePause:()=>l.phase===Ht.PAUSED?b.resume():b.pause(),respawn:()=>{l.respawn()&&(h.playerY=l.player.y,c.snap(l.player.facing),h.snapFacing(),A.hideScreens(),y.setVisible(!0))},toggleMute:()=>{d.setMuted(!d.muted),A.setMuteLabel(d.muted)},toggleView:()=>{const U=c.toggleMode();h.setFirstPerson(U==="first")},openEnding:()=>E(()=>{const U=de.filter(bt=>o.records[bt.id]?.[o.difficulty]?.completed).length,at=de.reduce((bt,_t)=>bt+(o.records[_t.id]?.[o.difficulty]?.stars??0),0);d.surfaced(),A.showEnding({levels:U,stars:at,difficulty:o.difficulty})})},A=new h1({root:x,hud:u,commands:b,touch:f}),y=new s1({root:x,onLook:(U,at)=>c.look(-U*.0065,-at*.005),onPulseDown:()=>{d.unlock(),l.beginCharge()&&d.startCharge()},onPulseUp:()=>{l.releasePulse(),d.stopCharge()},onPulseCancel:()=>{l.cancelCharge(),d.stopCharge()},onPause:()=>b.pause(),onView:()=>b.toggleView()});y.setEnabled(f);const w=U=>{U.pointerType!=="touch"||f||(f=!0,y.setEnabled(!0),A.setTouch(!0),p.touch=!0,l.phase===Ht.PLAYING&&y.setVisible(!0))};window.addEventListener("pointerdown",w,!0);const C=new Jv({target:n.container,controllerId:"player",keyBindings:{Space:"none",ArrowLeft:"none",ArrowRight:"none"},actionBindings:{Space:"pulse",Mouse0:"pulse",Escape:"pause",KeyP:"pause",Enter:"confirm",KeyM:"mute",KeyV:"view",KeyH:"help",Slash:"help",ArrowLeft:"turnLeft",ArrowRight:"turnRight"},lookMode:To.POINTER_LOCK,pointerSensitivity:0});C.enable();const R=n.renderer?.domElement??n.container.querySelector("canvas");n.container.addEventListener("pointerdown",U=>{if(U.pointerType==="mouse"&&l.phase===Ht.PLAYING&&!document.pointerLockElement)try{R.requestPointerLock?.()?.catch?.(()=>{})}catch{}}),document.addEventListener("mousemove",U=>{document.pointerLockElement===R&&l.phase===Ht.PLAYING&&c.look(-U.movementX*yf,-U.movementY*yf)}),document.addEventListener("pointerlockchange",()=>{!document.pointerLockElement&&l.phase===Ht.PLAYING&&b.pause()}),C.onAction((U,at)=>{const bt=l.phase;at!=="pressed"&&U!=="pulse"||(U==="pulse"?at==="pressed"?bt===Ht.PLAYING?(d.unlock(),l.beginCharge()&&d.startCharge()):bt===Ht.CAUGHT&&b.respawn():at==="released"&&bt===Ht.PLAYING&&(l.releasePulse(),d.stopCharge()):U==="pause"?bt===Ht.PLAYING?b.pause():bt===Ht.PAUSED&&performance.now()-m>250&&b.resume():U==="confirm"?bt===Ht.CAUGHT&&b.respawn():U==="mute"?b.toggleMute():U==="help"&&bt===Ht.PLAYING?A.showHelp(4):U==="view"&&bt===Ht.PLAYING&&b.toggleView())}),document.addEventListener("visibilitychange",()=>{document.hidden&&b.pause()});const I=U=>{for(const at of U)A.tip(at.text)};l.on("*",U=>p.onEvent(U)),l.on("pulse",U=>{d.pulse(U.kind,U.loudness,{wet:U.wet}),c.kick(U.loudness),U.kind==="full"?c.addShake(.22):U.kind==="mid"&&c.addShake(.08)}),l.on("softPulse",()=>d.pulse("tap",.3)),l.on("crystalEcho",U=>d.crystalEcho(U)),l.on("beastWake",U=>{d.growl({x:U.x,y:U.y+.7,z:U.z}),A.toast(U.cause==="wading"||U.cause==="footsteps"?"It heard you move":"Something stirs",1.8)}),l.on("beastAlert",U=>d.huff({x:U.x,y:U.y+.6,z:U.z})),l.on("beastLunge",U=>d.growl({x:U.x,y:U.y+.7,z:U.z},{short:!0})),l.on("greatWake",U=>{d.growl({x:U.x,y:U.y+1.4,z:U.z},{big:!0}),c.addShake(.8),A.toast("The Throat wakes. Climb!",3)}),l.on("step",U=>U.water?d.wade(Math.min(1,U.pace)):d.footstep(Math.min(1,U.pace)*.7)),l.on("mothCollected",U=>{d.chime(U.count),h.burst(U.x,U.y,U.z,16756794,7,{sparks:48}),A.toast(U.count>=U.required?"All five moths. The way out wakes.":`Glow-moth ${U.count} of ${U.required}`)}),l.on("exitOpened",()=>{d.exitOpened(),h.exitOpened()}),l.on("checkpoint",U=>{d.checkpoint(),h.burst(U.x,U.y,U.z,8257496,4),A.toast("Crystal lit: you will wake here")}),l.on("caught",()=>{d.stopCharge(),d.caught(),c.addShake(.6),y.setVisible(!1),document.pointerLockElement&&document.exitPointerLock?.(),A.showCaught(l.chase)}),l.on("won",U=>{const at=l.def,bt=at.id===de[de.length-1].id,_t=Sp(at,U),X=xb(o,at,U);o=X.progress,of(o),g={...U,stars:_t.stars},d.stopCharge(),d.win(),y.setVisible(!1),document.pointerLockElement&&document.exitPointerLock?.(),A.showResults({def:at,result:U,..._t,...X,last:bt})}),n.onTick(U=>{const at=C.sample();if(y.update(U),f&&l.phase===Ht.PLAYING&&A.tipTime>0&&(y.move.x||y.move.y)&&A.currentTipIs(p.textOf(l.def.hints?.find(X=>X.id==="move")??{}))&&A.endTip(),l.phase===Ht.PLAYING){const X=(C.pressedActions.has("turnLeft")?1:0)-(C.pressedActions.has("turnRight")?1:0);X&&c.look(X*c1*U,0)}const bt=Math.max(-1,Math.min(1,at.moveX+y.move.x)),_t=Math.max(-1,Math.min(1,at.moveY+y.move.y));l.update(U,{moveX:bt,moveY:_t,yaw:c.yaw,sneak:at.run})});let z=0,G=0;const L=new Set(["rousing","hunting","lunging","chasing"]),N=U=>{const at=l.player;let bt=1/0;if(l.phase===Ht.PLAYING)for(const X of l.beasts)L.has(X.state)&&(bt=Math.min(bt,Math.hypot(X.x-at.x,X.y-at.y,X.z-at.z)));let _t=0;if(bt<16){const X=Math.max(0,Math.min(1,(16-bt)/14.5));z=(z+U*(55+X*95)/60)%1;const nt=Math.max(Math.exp(-(((z-.06)/.055)**2)),.65*Math.exp(-(((z-.27)/.055)**2)));_t=(.3+.7*X)*(.3+.7*nt)}G=_t>G?_t:Math.max(_t,G-U*1.5),A.flashDanger(G)},D=[];let $=performance.now(),Q=0;n.onRender(U=>{const at=performance.now();D.push(at-$),$=at,D.length>120&&D.shift();const bt=n.camera;bt.aspect!==Q&&(Q=bt.aspect,c.baseFov=bt.aspect<1?Math.min(84,68+(1-bt.aspect)*30):68),h.setPointScale(n.renderer.getContext().drawingBufferHeight/(2*Math.tan(bt.fov*Math.PI/360)));const _t=S.sync(A.screen==="title"&&l.phase===Ht.TITLE);h.render(_t?S.update(U):U);const X=h.creature.group.position;_t||(c.update(U,{x:X.x,y:X.y,z:X.z},l.terrain),c.mode==="third"&&h.creature.setFade(c.fade));const nt=l.getState();A.update(U,nt,l.def.name),l.phase===Ht.PLAYING&&I(p.update(nt,l.level.start));const et=l.player;let Rt=1/0;for(const yt of l.beasts)yt.state==="sleeping"||yt.state==="dormant"||(Rt=Math.min(Rt,Math.hypot(yt.x-et.x,yt.y-et.y,yt.z-et.z)));let Dt=null;for(const yt of l.moths){if(yt.collected)continue;const te=Math.hypot(yt.x-et.x,yt.y-et.y,yt.z-et.z);(!Dt||te<Dt.distance)&&(Dt={distance:te,pos:{x:yt.x,y:yt.y+1,z:yt.z}})}N(U),d.setListener(et.x,et.y+.5,et.z,c.yaw),d.update(U,{playing:l.phase===Ht.PLAYING,nearestMoth:Dt,danger:Rt,dripSpot:()=>{for(let yt=0;yt<6;yt+=1){const te=et.x+(Math.random()-.5)*24,St=et.z+(Math.random()-.5)*24,Ft=l.level.nav.player,kt=Math.round(te)-1,Ot=Math.round(St)-1;if(kt>=0&&Ot>=0&&kt<Ft.w&&Ot<Ft.h&&Ft.walk[Ot*Ft.w+kt])return{x:te,y:et.y+2.5,z:St}}return null}})});const st=()=>D.length<10?0:1e3/(D.reduce((at,bt)=>at+bt,0)/D.length),rt={host:n,input:C,get rules(){return l},rig:c,audio:d,commands:b,getState:()=>({...l.getState(),screen:A.screen,fps:Math.round(st()*10)/10,camera:c.getState(),touchUI:!y.el.hidden,touchMode:f,levelName:l.def.name,quality:e,bloom:!!s?.enabled,particles:!!h.particles,backdrop:S.active,pixelRatio:n.renderer.getPixelRatio(),vignette:Math.round(G*100)/100,toast:A.toastTime>0?u.root.querySelector(".eb-toast")?.textContent??"":"",progress:o,lastResult:g,tip:A.tipTime>0?u.root.querySelector(".eb-tip")?.textContent??"":""}),pathTo:(U,at)=>Ao(l.level.nav.player,l.player,{x:U,z:at})??[]};return globalThis.__A3GAME_GAME__=rt,/[?&]debug\b/.test(globalThis.location?.search??"")&&(globalThis.__EB_DEBUG__={get scene(){return h},host:n,rules:l,bloom:s,rig:c,isAir:ha,ceilAt:hn}),globalThis.__A3GAME_PLAYTEST__={warmup:.5,look:"off",actions:[{id:"select",taps:["Enter"],duration:.6},{id:"start",taps:["Enter"],duration:.8},{id:"skip_intro",taps:["Enter"],duration:.8},{id:"move_forward",keys:["KeyW"],duration:1.5},{id:"tap_pulse",taps:["Space"],duration:1.5},{id:"turn",keys:["ArrowLeft"],duration:.8},{id:"loud_pulse",keys:["Space"],duration:1.2},{id:"watch_echo",duration:2.5}]},A.showTitle(o),n.start(),rt}const _f=r=>{console.error(r);const t=document.getElementById("boot-error");t&&(t.hidden=!1,t.textContent=`Could not start: ${r.message}`)};async function g1(){const{renderAudioLevels:r}=await Op(async()=>{const{renderAudioLevels:i}=await import("./audiotest-bID_LoIN.js");return{renderAudioLevels:i}},[],import.meta.url),t=await r();globalThis.__AUDIO_LEVELS__=t;const e=t.cues.map(i=>`<tr><td>${i.name}</td><td>${i.peakDb}</td><td>${i.rmsDb}</td><td>${i.activeSeconds}</td><td>${i.clipping?"CLIPS":i.silent?"SILENT":"ok"}</td></tr>`).join("");document.body.style.overflow="auto",document.body.innerHTML=`<div style="font:14px system-ui;color:#d9f6ff;padding:16px"><h2>Echoes Below audio levels (${t.ok?"all pass":"FAIL"})</h2>
    <table cellpadding="4"><tr><th align=left>cue</th><th>peak dBFS</th><th>RMS dBFS</th><th>active s</th><th></th></tr>${e}</table></div>`}new URLSearchParams(location.search).has("audiotest")?g1().catch(_f):m1().catch(_f);export{Qv as C};
