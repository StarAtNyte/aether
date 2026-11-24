(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const s of n)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&i(a)}).observe(document,{childList:!0,subtree:!0});function e(n){const s={};return n.integrity&&(s.integrity=n.integrity),n.referrerPolicy&&(s.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?s.credentials="include":n.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(n){if(n.ep)return;n.ep=!0;const s=e(n);fetch(n.href,s)}})();const Zf="modulepreload",Kf=function(r,t){return new URL(r,t).href},vc={},Jf=function(t,e,i){let n=Promise.resolve();if(e&&e.length>0){let a=function(c){return Promise.all(c.map(d=>Promise.resolve(d).then(u=>({status:"fulfilled",value:u}),u=>({status:"rejected",reason:u}))))};const o=document.getElementsByTagName("link"),l=document.querySelector("meta[property=csp-nonce]"),h=l?.nonce||l?.getAttribute("nonce");n=a(e.map(c=>{if(c=Kf(c,i),c in vc)return;vc[c]=!0;const d=c.endsWith(".css"),u=d?'[rel="stylesheet"]':"";if(!!i)for(let x=o.length-1;x>=0;x--){const g=o[x];if(g.href===c&&(!d||g.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${c}"]${u}`))return;const p=document.createElement("link");if(p.rel=d?"stylesheet":Zf,d||(p.as="script"),p.crossOrigin="",p.href=c,h&&p.setAttribute("nonce",h),document.head.appendChild(p),d)return new Promise((x,g)=>{p.addEventListener("load",x),p.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${c}`)))})}))}function s(a){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=a,window.dispatchEvent(o),!o.defaultPrevented)throw a}return n.then(a=>{for(const o of a||[])o.status==="rejected"&&s(o.reason);return t().catch(s)})};/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const zh="185",qs={ROTATE:0,DOLLY:1,PAN:2},Ws={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Qf=0,Mc=1,jf=2,Za=1,Nd=2,Cr=3,Dn=0,Ue=1,en=2,sn=0,$s=1,bc=2,Sc=3,wc=4,tp=5,qn=100,ep=101,ip=102,np=103,sp=104,rp=200,ap=201,op=202,lp=203,Bl=204,Vl=205,hp=206,cp=207,up=208,dp=209,fp=210,pp=211,mp=212,gp=213,xp=214,Gl=0,Hl=1,Wl=2,tr=3,Xl=4,ql=5,$l=6,Yl=7,Oh=0,_p=1,yp=2,Ti=0,kh=1,Bh=2,Vh=3,Gh=4,Fd=5,Hh=6,Mo=7,Ud=300,Kn=301,er=302,Lr=303,Do=304,bo=306,Zl=1e3,nn=1001,Kl=1002,Ne=1003,vp=1004,Qr=1005,He=1006,Io=1007,Yn=1008,ai=1009,zd=1010,Od=1011,Vr=1012,Wh=1013,Hi=1014,wi=1015,ln=1016,Xh=1017,qh=1018,Gr=1020,kd=35902,Bd=35899,Vd=1021,Gd=1022,Ei=1023,hn=1026,Zn=1027,$h=1028,Yh=1029,Jn=1030,Zh=1031,Kh=1033,Ka=33776,Ja=33777,Qa=33778,ja=33779,Jl=35840,Ql=35841,jl=35842,th=35843,eh=36196,ih=37492,nh=37496,sh=37488,rh=37489,ao=37490,ah=37491,oh=37808,lh=37809,hh=37810,ch=37811,uh=37812,dh=37813,fh=37814,ph=37815,mh=37816,gh=37817,xh=37818,_h=37819,yh=37820,vh=37821,Mh=36492,bh=36494,Sh=36495,wh=36283,Eh=36284,oo=36285,Th=36286,Mp=3200,lo=0,bp=1,Tn="",si="srgb",ho="srgb-linear",co="linear",te="srgb",ss=7680,Ec=519,Sp=512,wp=513,Ep=514,Jh=515,Tp=516,Ap=517,Qh=518,Rp=519,Tc=35044,Ac="300 es",Bi=2e3,Hr=2001;function Cp(r){for(let t=r.length-1;t>=0;--t)if(r[t]>=65535)return!0;return!1}function uo(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}function Pp(){const r=uo("canvas");return r.style.display="block",r}const Rc={};function Cc(...r){const t="THREE."+r.shift();console.log(t,...r)}function Hd(r){const t=r[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=r[1];e&&e.isStackTrace?r[0]+=" "+e.getLocation():r[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return r}function Lt(...r){r=Hd(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...r)}}function Zt(...r){r=Hd(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...r)}}function Ys(...r){const t=r.join(" ");t in Rc||(Rc[t]=!0,Lt(...r))}function Dp(r,t,e){return new Promise(function(i,n){function s(){switch(r.clientWaitSync(t,r.SYNC_FLUSH_COMMANDS_BIT,0)){case r.WAIT_FAILED:n();break;case r.TIMEOUT_EXPIRED:setTimeout(s,e);break;default:i()}}setTimeout(s,e)})}const Ip={[Gl]:Hl,[Wl]:$l,[Xl]:Yl,[tr]:ql,[Hl]:Gl,[$l]:Wl,[Yl]:Xl,[ql]:tr};let Nn=class{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(e)===-1&&i[t].push(e)}hasEventListener(t,e){const i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(e)!==-1}removeEventListener(t,e){const i=this._listeners;if(i===void 0)return;const n=i[t];if(n!==void 0){const s=n.indexOf(e);s!==-1&&n.splice(s,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const i=e[t.type];if(i!==void 0){t.target=this;const n=i.slice(0);for(let s=0,a=n.length;s<a;s++)n[s].call(this,t);t.target=null}}};const ke=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let Pc=1234567;const Nr=Math.PI/180,Wr=180/Math.PI;function rr(){const r=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(ke[r&255]+ke[r>>8&255]+ke[r>>16&255]+ke[r>>24&255]+"-"+ke[t&255]+ke[t>>8&255]+"-"+ke[t>>16&15|64]+ke[t>>24&255]+"-"+ke[e&63|128]+ke[e>>8&255]+"-"+ke[e>>16&255]+ke[e>>24&255]+ke[i&255]+ke[i>>8&255]+ke[i>>16&255]+ke[i>>24&255]).toLowerCase()}function Wt(r,t,e){return Math.max(t,Math.min(e,r))}function jh(r,t){return(r%t+t)%t}function Lp(r,t,e,i,n){return i+(r-t)*(n-i)/(e-t)}function Np(r,t,e){return r!==t?(e-r)/(t-r):0}function Fr(r,t,e){return(1-e)*r+e*t}function Fp(r,t,e,i){return Fr(r,t,1-Math.exp(-e*i))}function Up(r,t=1){return t-Math.abs(jh(r,t*2)-t)}function zp(r,t,e){return r<=t?0:r>=e?1:(r=(r-t)/(e-t),r*r*(3-2*r))}function Op(r,t,e){return r<=t?0:r>=e?1:(r=(r-t)/(e-t),r*r*r*(r*(r*6-15)+10))}function kp(r,t){return r+Math.floor(Math.random()*(t-r+1))}function Bp(r,t){return r+Math.random()*(t-r)}function Vp(r){return r*(.5-Math.random())}function Gp(r){r!==void 0&&(Pc=r);let t=Pc+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function Hp(r){return r*Nr}function Wp(r){return r*Wr}function Xp(r){return(r&r-1)===0&&r!==0}function qp(r){return Math.pow(2,Math.ceil(Math.log(r)/Math.LN2))}function $p(r){return Math.pow(2,Math.floor(Math.log(r)/Math.LN2))}function Yp(r,t,e,i,n){const s=Math.cos,a=Math.sin,o=s(e/2),l=a(e/2),h=s((t+i)/2),c=a((t+i)/2),d=s((t-i)/2),u=a((t-i)/2),f=s((i-t)/2),p=a((i-t)/2);switch(n){case"XYX":r.set(o*c,l*d,l*u,o*h);break;case"YZY":r.set(l*u,o*c,l*d,o*h);break;case"ZXZ":r.set(l*d,l*u,o*c,o*h);break;case"XZX":r.set(o*c,l*p,l*f,o*h);break;case"YXY":r.set(l*f,o*c,l*p,o*h);break;case"ZYZ":r.set(l*p,l*f,o*c,o*h);break;default:Lt("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+n)}}function Vs(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function Xe(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}const Ah={DEG2RAD:Nr,RAD2DEG:Wr,generateUUID:rr,clamp:Wt,euclideanModulo:jh,mapLinear:Lp,inverseLerp:Np,lerp:Fr,damp:Fp,pingpong:Up,smoothstep:zp,smootherstep:Op,randInt:kp,randFloat:Bp,randFloatSpread:Vp,seededRandom:Gp,degToRad:Hp,radToDeg:Wp,isPowerOfTwo:Xp,ceilPowerOfTwo:qp,floorPowerOfTwo:$p,setQuaternionFromProperEuler:Yp,normalize:Xe,denormalize:Vs};let Nt=class Wd{static{Wd.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,i=this.y,n=t.elements;return this.x=n[0]*e+n[3]*i+n[6],this.y=n[1]*e+n[4]*i+n[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Wt(this.x,t.x,e.x),this.y=Wt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Wt(this.x,t,e),this.y=Wt(this.y,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Wt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Wt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y;return e*e+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const i=Math.cos(e),n=Math.sin(e),s=this.x-t.x,a=this.y-t.y;return this.x=s*i-a*n+t.x,this.y=s*n+a*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},In=class{constructor(t=0,e=0,i=0,n=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=i,this._w=n}static slerpFlat(t,e,i,n,s,a,o){let l=i[n+0],h=i[n+1],c=i[n+2],d=i[n+3],u=s[a+0],f=s[a+1],p=s[a+2],x=s[a+3];if(d!==x||l!==u||h!==f||c!==p){let g=l*u+h*f+c*p+d*x;g<0&&(u=-u,f=-f,p=-p,x=-x,g=-g);let m=1-o;if(g<.9995){const M=Math.acos(g),E=Math.sin(M);m=Math.sin(m*M)/E,o=Math.sin(o*M)/E,l=l*m+u*o,h=h*m+f*o,c=c*m+p*o,d=d*m+x*o}else{l=l*m+u*o,h=h*m+f*o,c=c*m+p*o,d=d*m+x*o;const M=1/Math.sqrt(l*l+h*h+c*c+d*d);l*=M,h*=M,c*=M,d*=M}}t[e]=l,t[e+1]=h,t[e+2]=c,t[e+3]=d}static multiplyQuaternionsFlat(t,e,i,n,s,a){const o=i[n],l=i[n+1],h=i[n+2],c=i[n+3],d=s[a],u=s[a+1],f=s[a+2],p=s[a+3];return t[e]=o*p+c*d+l*f-h*u,t[e+1]=l*p+c*u+h*d-o*f,t[e+2]=h*p+c*f+o*u-l*d,t[e+3]=c*p-o*d-l*u-h*f,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,i,n){return this._x=t,this._y=e,this._z=i,this._w=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const i=t._x,n=t._y,s=t._z,a=t._order,o=Math.cos,l=Math.sin,h=o(i/2),c=o(n/2),d=o(s/2),u=l(i/2),f=l(n/2),p=l(s/2);switch(a){case"XYZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"YXZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"ZXY":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"ZYX":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"YZX":this._x=u*c*d+h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d-u*f*p;break;case"XZY":this._x=u*c*d-h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d+u*f*p;break;default:Lt("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const i=e/2,n=Math.sin(i);return this._x=t.x*n,this._y=t.y*n,this._z=t.z*n,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,i=e[0],n=e[4],s=e[8],a=e[1],o=e[5],l=e[9],h=e[2],c=e[6],d=e[10],u=i+o+d;if(u>0){const f=.5/Math.sqrt(u+1);this._w=.25/f,this._x=(c-l)*f,this._y=(s-h)*f,this._z=(a-n)*f}else if(i>o&&i>d){const f=2*Math.sqrt(1+i-o-d);this._w=(c-l)/f,this._x=.25*f,this._y=(n+a)/f,this._z=(s+h)/f}else if(o>d){const f=2*Math.sqrt(1+o-i-d);this._w=(s-h)/f,this._x=(n+a)/f,this._y=.25*f,this._z=(l+c)/f}else{const f=2*Math.sqrt(1+d-i-o);this._w=(a-n)/f,this._x=(s+h)/f,this._y=(l+c)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let i=t.dot(e)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Wt(this.dot(t),-1,1)))}rotateTowards(t,e){const i=this.angleTo(t);if(i===0)return this;const n=Math.min(1,e/i);return this.slerp(t,n),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const i=t._x,n=t._y,s=t._z,a=t._w,o=e._x,l=e._y,h=e._z,c=e._w;return this._x=i*c+a*o+n*h-s*l,this._y=n*c+a*l+s*o-i*h,this._z=s*c+a*h+i*l-n*o,this._w=a*c-i*o-n*l-s*h,this._onChangeCallback(),this}slerp(t,e){let i=t._x,n=t._y,s=t._z,a=t._w,o=this.dot(t);o<0&&(i=-i,n=-n,s=-s,a=-a,o=-o);let l=1-e;if(o<.9995){const h=Math.acos(o),c=Math.sin(h);l=Math.sin(l*h)/c,e=Math.sin(e*h)/c,this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,i){return this.copy(t).slerp(e,i)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),i=Math.random(),n=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(n*Math.sin(t),n*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},U=class Xd{static{Xd.prototype.isVector3=!0}constructor(t=0,e=0,i=0){this.x=t,this.y=e,this.z=i}set(t,e,i){return i===void 0&&(i=this.z),this.x=t,this.y=e,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(Dc.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(Dc.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[3]*i+s[6]*n,this.y=s[1]*e+s[4]*i+s[7]*n,this.z=s[2]*e+s[5]*i+s[8]*n,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=t.elements,a=1/(s[3]*e+s[7]*i+s[11]*n+s[15]);return this.x=(s[0]*e+s[4]*i+s[8]*n+s[12])*a,this.y=(s[1]*e+s[5]*i+s[9]*n+s[13])*a,this.z=(s[2]*e+s[6]*i+s[10]*n+s[14])*a,this}applyQuaternion(t){const e=this.x,i=this.y,n=this.z,s=t.x,a=t.y,o=t.z,l=t.w,h=2*(a*n-o*i),c=2*(o*e-s*n),d=2*(s*i-a*e);return this.x=e+l*h+a*d-o*c,this.y=i+l*c+o*h-s*d,this.z=n+l*d+s*c-a*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[4]*i+s[8]*n,this.y=s[1]*e+s[5]*i+s[9]*n,this.z=s[2]*e+s[6]*i+s[10]*n,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Wt(this.x,t.x,e.x),this.y=Wt(this.y,t.y,e.y),this.z=Wt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Wt(this.x,t,e),this.y=Wt(this.y,t,e),this.z=Wt(this.z,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Wt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const i=t.x,n=t.y,s=t.z,a=e.x,o=e.y,l=e.z;return this.x=n*l-s*o,this.y=s*a-i*l,this.z=i*o-n*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const i=t.dot(this)/e;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return Lo.copy(this).projectOnVector(t),this.sub(Lo)}reflect(t){return this.sub(Lo.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Wt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y,n=this.z-t.z;return e*e+i*i+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,i){const n=Math.sin(e)*t;return this.x=n*Math.sin(i),this.y=Math.cos(e)*t,this.z=n*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,i){return this.x=t*Math.sin(e),this.y=i,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),n=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=i,this.z=n,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,i=Math.sqrt(1-e*e);return this.x=i*Math.cos(t),this.y=e,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};const Lo=new U,Dc=new In;let Ot=class qd{static{qd.prototype.isMatrix3=!0}constructor(t,e,i,n,s,a,o,l,h){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h)}set(t,e,i,n,s,a,o,l,h){const c=this.elements;return c[0]=t,c[1]=n,c[2]=o,c[3]=e,c[4]=s,c[5]=l,c[6]=i,c[7]=a,c[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],this}extractBasis(t,e,i){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[3],l=i[6],h=i[1],c=i[4],d=i[7],u=i[2],f=i[5],p=i[8],x=n[0],g=n[3],m=n[6],M=n[1],E=n[4],v=n[7],w=n[2],b=n[5],A=n[8];return s[0]=a*x+o*M+l*w,s[3]=a*g+o*E+l*b,s[6]=a*m+o*v+l*A,s[1]=h*x+c*M+d*w,s[4]=h*g+c*E+d*b,s[7]=h*m+c*v+d*A,s[2]=u*x+f*M+p*w,s[5]=u*g+f*E+p*b,s[8]=u*m+f*v+p*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8];return e*a*c-e*o*h-i*s*c+i*o*l+n*s*h-n*a*l}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=c*a-o*h,u=o*l-c*s,f=h*s-a*l,p=e*d+i*u+n*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/p;return t[0]=d*x,t[1]=(n*h-c*i)*x,t[2]=(o*i-n*a)*x,t[3]=u*x,t[4]=(c*e-n*l)*x,t[5]=(n*s-o*e)*x,t[6]=f*x,t[7]=(i*l-h*e)*x,t[8]=(a*e-i*s)*x,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,i,n,s,a,o){const l=Math.cos(s),h=Math.sin(s);return this.set(i*l,i*h,-i*(l*a+h*o)+a+t,-n*h,n*l,-n*(-h*a+l*o)+o+e,0,0,1),this}scale(t,e){return Ys("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(No.makeScale(t,e)),this}rotate(t){return Ys("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(No.makeRotation(-t)),this}translate(t,e){return Ys("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(No.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,i,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<9;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<9;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}};const No=new Ot,Ic=new Ot().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Lc=new Ot().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Zp(){const r={enabled:!0,workingColorSpace:ho,spaces:{},convert:function(n,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===te&&(n.r=rn(n.r),n.g=rn(n.g),n.b=rn(n.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(n.applyMatrix3(this.spaces[s].toXYZ),n.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===te&&(n.r=Zs(n.r),n.g=Zs(n.g),n.b=Zs(n.b))),n},workingToColorSpace:function(n,s){return this.convert(n,this.workingColorSpace,s)},colorSpaceToWorking:function(n,s){return this.convert(n,s,this.workingColorSpace)},getPrimaries:function(n){return this.spaces[n].primaries},getTransfer:function(n){return n===Tn?co:this.spaces[n].transfer},getToneMappingMode:function(n){return this.spaces[n].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(n,s=this.workingColorSpace){return n.fromArray(this.spaces[s].luminanceCoefficients)},define:function(n){Object.assign(this.spaces,n)},_getMatrix:function(n,s,a){return n.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(n){return this.spaces[n].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(n=this.workingColorSpace){return this.spaces[n].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(n,s){return Ys("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),r.workingToColorSpace(n,s)},toWorkingColorSpace:function(n,s){return Ys("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),r.colorSpaceToWorking(n,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],i=[.3127,.329];return r.define({[ho]:{primaries:t,whitePoint:i,transfer:co,toXYZ:Ic,fromXYZ:Lc,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:si},outputColorSpaceConfig:{drawingBufferColorSpace:si}},[si]:{primaries:t,whitePoint:i,transfer:te,toXYZ:Ic,fromXYZ:Lc,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:si}}}),r}const $t=Zp();function rn(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function Zs(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}let rs,Kp=class{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{rs===void 0&&(rs=uo("canvas")),rs.width=t.width,rs.height=t.height;const n=rs.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),i=rs}return i.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=uo("canvas");e.width=t.width,e.height=t.height;const i=e.getContext("2d");i.drawImage(t,0,0,t.width,t.height);const n=i.getImageData(0,0,t.width,t.height),s=n.data;for(let a=0;a<s.length;a++)s[a]=rn(s[a]/255)*255;return i.putImageData(n,0,0),e}else if(t.data){const e=t.data.slice(0);for(let i=0;i<e.length;i++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[i]=Math.floor(rn(e[i]/255)*255):e[i]=rn(e[i]);return{data:e,width:t.width,height:t.height}}else return Lt("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},Jp=0,tc=class{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Jp++}),this.uuid=rr(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const i={uuid:this.uuid,url:""},n=this.data;if(n!==null){let s;if(Array.isArray(n)){s=[];for(let a=0,o=n.length;a<o;a++)n[a].isDataTexture?s.push(Fo(n[a].image)):s.push(Fo(n[a]))}else s=Fo(n);i.url=s}return e||(t.images[this.uuid]=i),i}};function Fo(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?Kp.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(Lt("Texture: Unable to serialize Texture."),{})}let Qp=0;const Uo=new U;let Ci=class to extends Nn{constructor(t=to.DEFAULT_IMAGE,e=to.DEFAULT_MAPPING,i=nn,n=nn,s=He,a=Yn,o=Ei,l=ai,h=to.DEFAULT_ANISOTROPY,c=Tn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Qp++}),this.uuid=rr(),this.name="",this.source=new tc(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=i,this.wrapT=n,this.magFilter=s,this.minFilter=a,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Nt(0,0),this.repeat=new Nt(1,1),this.center=new Nt(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ot,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=c,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Uo).x}get height(){return this.source.getSize(Uo).y}get depth(){return this.source.getSize(Uo).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const i=t[e];if(i===void 0){Lt(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Lt(`Texture.setValues(): property '${e}' does not exist.`);continue}n&&i&&n.isVector2&&i.isVector2||n&&i&&n.isVector3&&i.isVector3||n&&i&&n.isMatrix3&&i.isMatrix3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),e||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==Ud)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Zl:t.x=t.x-Math.floor(t.x);break;case nn:t.x=t.x<0?0:1;break;case Kl:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Zl:t.y=t.y-Math.floor(t.y);break;case nn:t.y=t.y<0?0:1;break;case Kl:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};Ci.DEFAULT_IMAGE=null;Ci.DEFAULT_MAPPING=Ud;Ci.DEFAULT_ANISOTROPY=1;let _e=class $d{static{$d.prototype.isVector4=!0}constructor(t=0,e=0,i=0,n=1){this.x=t,this.y=e,this.z=i,this.w=n}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,i,n){return this.x=t,this.y=e,this.z=i,this.w=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=this.w,a=t.elements;return this.x=a[0]*e+a[4]*i+a[8]*n+a[12]*s,this.y=a[1]*e+a[5]*i+a[9]*n+a[13]*s,this.z=a[2]*e+a[6]*i+a[10]*n+a[14]*s,this.w=a[3]*e+a[7]*i+a[11]*n+a[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,i,n,s;const l=t.elements,h=l[0],c=l[4],d=l[8],u=l[1],f=l[5],p=l[9],x=l[2],g=l[6],m=l[10];if(Math.abs(c-u)<.01&&Math.abs(d-x)<.01&&Math.abs(p-g)<.01){if(Math.abs(c+u)<.1&&Math.abs(d+x)<.1&&Math.abs(p+g)<.1&&Math.abs(h+f+m-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const E=(h+1)/2,v=(f+1)/2,w=(m+1)/2,b=(c+u)/4,A=(d+x)/4,_=(p+g)/4;return E>v&&E>w?E<.01?(i=0,n=.707106781,s=.707106781):(i=Math.sqrt(E),n=b/i,s=A/i):v>w?v<.01?(i=.707106781,n=0,s=.707106781):(n=Math.sqrt(v),i=b/n,s=_/n):w<.01?(i=.707106781,n=.707106781,s=0):(s=Math.sqrt(w),i=A/s,n=_/s),this.set(i,n,s,e),this}let M=Math.sqrt((g-p)*(g-p)+(d-x)*(d-x)+(u-c)*(u-c));return Math.abs(M)<.001&&(M=1),this.x=(g-p)/M,this.y=(d-x)/M,this.z=(u-c)/M,this.w=Math.acos((h+f+m-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Wt(this.x,t.x,e.x),this.y=Wt(this.y,t.y,e.y),this.z=Wt(this.z,t.z,e.z),this.w=Wt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Wt(this.x,t,e),this.y=Wt(this.y,t,e),this.z=Wt(this.z,t,e),this.w=Wt(this.w,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Wt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this.w=t.w+(e.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},jp=class extends Nn{constructor(t=1,e=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:He,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},i),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=i.depth,this.scissor=new _e(0,0,t,e),this.scissorTest=!1,this.viewport=new _e(0,0,t,e),this.textures=[];const n={width:t,height:e,depth:i.depth},s=new Ci(n),a=i.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview,this.useArrayDepthTexture=i.useArrayDepthTexture}_setTextureOptions(t={}){const e={minFilter:He,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,i=1){if(this.width!==t||this.height!==e||this.depth!==i){this.width=t,this.height=e,this.depth=i;for(let n=0,s=this.textures.length;n<s;n++)this.textures[n].image.width=t,this.textures[n].image.height=e,this.textures[n].image.depth=i,this.textures[n].isData3DTexture!==!0&&(this.textures[n].isArrayTexture=this.textures[n].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,i=t.textures.length;e<i;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const n=Object.assign({},t.textures[e].image);this.textures[e].source=new tc(n)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},Gi=class extends jp{constructor(t=1,e=1,i={}){super(t,e,i),this.isWebGLRenderTarget=!0}};class Yd extends Ci{constructor(t=null,e=1,i=1,n=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:i,depth:n},this.magFilter=Ne,this.minFilter=Ne,this.wrapR=nn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class tm extends Ci{constructor(t=null,e=1,i=1,n=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:i,depth:n},this.magFilter=Ne,this.minFilter=Ne,this.wrapR=nn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}let ue=class Rh{static{Rh.prototype.isMatrix4=!0}constructor(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,g)}set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,g){const m=this.elements;return m[0]=t,m[4]=e,m[8]=i,m[12]=n,m[1]=s,m[5]=a,m[9]=o,m[13]=l,m[2]=h,m[6]=c,m[10]=d,m[14]=u,m[3]=f,m[7]=p,m[11]=x,m[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Rh().fromArray(this.elements)}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],e[9]=i[9],e[10]=i[10],e[11]=i[11],e[12]=i[12],e[13]=i[13],e[14]=i[14],e[15]=i[15],this}copyPosition(t){const e=this.elements,i=t.elements;return e[12]=i[12],e[13]=i[13],e[14]=i[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,i){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,e,i){return this.set(t.x,e.x,i.x,0,t.y,e.y,i.y,0,t.z,e.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,i=t.elements,n=1/as.setFromMatrixColumn(t,0).length(),s=1/as.setFromMatrixColumn(t,1).length(),a=1/as.setFromMatrixColumn(t,2).length();return e[0]=i[0]*n,e[1]=i[1]*n,e[2]=i[2]*n,e[3]=0,e[4]=i[4]*s,e[5]=i[5]*s,e[6]=i[6]*s,e[7]=0,e[8]=i[8]*a,e[9]=i[9]*a,e[10]=i[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,i=t.x,n=t.y,s=t.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(n),h=Math.sin(n),c=Math.cos(s),d=Math.sin(s);if(t.order==="XYZ"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=-l*d,e[8]=h,e[1]=f+p*h,e[5]=u-x*h,e[9]=-o*l,e[2]=x-u*h,e[6]=p+f*h,e[10]=a*l}else if(t.order==="YXZ"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u+x*o,e[4]=p*o-f,e[8]=a*h,e[1]=a*d,e[5]=a*c,e[9]=-o,e[2]=f*o-p,e[6]=x+u*o,e[10]=a*l}else if(t.order==="ZXY"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u-x*o,e[4]=-a*d,e[8]=p+f*o,e[1]=f+p*o,e[5]=a*c,e[9]=x-u*o,e[2]=-a*h,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=p*h-f,e[8]=u*h+x,e[1]=l*d,e[5]=x*h+u,e[9]=f*h-p,e[2]=-h,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=x-u*d,e[8]=p*d+f,e[1]=d,e[5]=a*c,e[9]=-o*c,e[2]=-h*c,e[6]=f*d+p,e[10]=u-x*d}else if(t.order==="XZY"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=-d,e[8]=h*c,e[1]=u*d+x,e[5]=a*c,e[9]=f*d-p,e[2]=p*d-f,e[6]=o*c,e[10]=x*d+u}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(em,t,im)}lookAt(t,e,i){const n=this.elements;return ti.subVectors(t,e),ti.lengthSq()===0&&(ti.z=1),ti.normalize(),pn.crossVectors(i,ti),pn.lengthSq()===0&&(Math.abs(i.z)===1?ti.x+=1e-4:ti.z+=1e-4,ti.normalize(),pn.crossVectors(i,ti)),pn.normalize(),jr.crossVectors(ti,pn),n[0]=pn.x,n[4]=jr.x,n[8]=ti.x,n[1]=pn.y,n[5]=jr.y,n[9]=ti.y,n[2]=pn.z,n[6]=jr.z,n[10]=ti.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[4],l=i[8],h=i[12],c=i[1],d=i[5],u=i[9],f=i[13],p=i[2],x=i[6],g=i[10],m=i[14],M=i[3],E=i[7],v=i[11],w=i[15],b=n[0],A=n[4],_=n[8],T=n[12],C=n[1],P=n[5],D=n[9],O=n[13],H=n[2],F=n[6],q=n[10],G=n[14],J=n[3],et=n[7],at=n[11],rt=n[15];return s[0]=a*b+o*C+l*H+h*J,s[4]=a*A+o*P+l*F+h*et,s[8]=a*_+o*D+l*q+h*at,s[12]=a*T+o*O+l*G+h*rt,s[1]=c*b+d*C+u*H+f*J,s[5]=c*A+d*P+u*F+f*et,s[9]=c*_+d*D+u*q+f*at,s[13]=c*T+d*O+u*G+f*rt,s[2]=p*b+x*C+g*H+m*J,s[6]=p*A+x*P+g*F+m*et,s[10]=p*_+x*D+g*q+m*at,s[14]=p*T+x*O+g*G+m*rt,s[3]=M*b+E*C+v*H+w*J,s[7]=M*A+E*P+v*F+w*et,s[11]=M*_+E*D+v*q+w*at,s[15]=M*T+E*O+v*G+w*rt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[12],a=t[1],o=t[5],l=t[9],h=t[13],c=t[2],d=t[6],u=t[10],f=t[14],p=t[3],x=t[7],g=t[11],m=t[15],M=l*f-h*u,E=o*f-h*d,v=o*u-l*d,w=a*f-h*c,b=a*u-l*c,A=a*d-o*c;return e*(x*M-g*E+m*v)-i*(p*M-g*w+m*b)+n*(p*E-x*w+m*A)-s*(p*v-x*b+g*A)}determinantAffine(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[1],a=t[5],o=t[9],l=t[2],h=t[6],c=t[10];return e*(a*c-o*h)-i*(s*c-o*l)+n*(s*h-a*l)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,i){const n=this.elements;return t.isVector3?(n[12]=t.x,n[13]=t.y,n[14]=t.z):(n[12]=t,n[13]=e,n[14]=i),this}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=t[9],u=t[10],f=t[11],p=t[12],x=t[13],g=t[14],m=t[15],M=e*o-i*a,E=e*l-n*a,v=e*h-s*a,w=i*l-n*o,b=i*h-s*o,A=n*h-s*l,_=c*x-d*p,T=c*g-u*p,C=c*m-f*p,P=d*g-u*x,D=d*m-f*x,O=u*m-f*g,H=M*O-E*D+v*P+w*C-b*T+A*_;if(H===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const F=1/H;return t[0]=(o*O-l*D+h*P)*F,t[1]=(n*D-i*O-s*P)*F,t[2]=(x*A-g*b+m*w)*F,t[3]=(u*b-d*A-f*w)*F,t[4]=(l*C-a*O-h*T)*F,t[5]=(e*O-n*C+s*T)*F,t[6]=(g*v-p*A-m*E)*F,t[7]=(c*A-u*v+f*E)*F,t[8]=(a*D-o*C+h*_)*F,t[9]=(i*C-e*D-s*_)*F,t[10]=(p*b-x*v+m*M)*F,t[11]=(d*v-c*b-f*M)*F,t[12]=(o*T-a*P-l*_)*F,t[13]=(e*P-i*T+n*_)*F,t[14]=(x*E-p*w-g*M)*F,t[15]=(c*w-d*E+u*M)*F,this}scale(t){const e=this.elements,i=t.x,n=t.y,s=t.z;return e[0]*=i,e[4]*=n,e[8]*=s,e[1]*=i,e[5]*=n,e[9]*=s,e[2]*=i,e[6]*=n,e[10]*=s,e[3]*=i,e[7]*=n,e[11]*=s,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],n=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,i,n))}makeTranslation(t,e,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,i,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,e,-i,0,0,i,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,0,i,0,0,1,0,0,-i,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,0,i,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const i=Math.cos(e),n=Math.sin(e),s=1-i,a=t.x,o=t.y,l=t.z,h=s*a,c=s*o;return this.set(h*a+i,h*o-n*l,h*l+n*o,0,h*o+n*l,c*o+i,c*l-n*a,0,h*l-n*o,c*l+n*a,s*l*l+i,0,0,0,0,1),this}makeScale(t,e,i){return this.set(t,0,0,0,0,e,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,e,i,n,s,a){return this.set(1,i,s,0,t,1,a,0,e,n,1,0,0,0,0,1),this}compose(t,e,i){const n=this.elements,s=e._x,a=e._y,o=e._z,l=e._w,h=s+s,c=a+a,d=o+o,u=s*h,f=s*c,p=s*d,x=a*c,g=a*d,m=o*d,M=l*h,E=l*c,v=l*d,w=i.x,b=i.y,A=i.z;return n[0]=(1-(x+m))*w,n[1]=(f+v)*w,n[2]=(p-E)*w,n[3]=0,n[4]=(f-v)*b,n[5]=(1-(u+m))*b,n[6]=(g+M)*b,n[7]=0,n[8]=(p+E)*A,n[9]=(g-M)*A,n[10]=(1-(u+x))*A,n[11]=0,n[12]=t.x,n[13]=t.y,n[14]=t.z,n[15]=1,this}decompose(t,e,i){const n=this.elements;t.x=n[12],t.y=n[13],t.z=n[14];const s=this.determinantAffine();if(s===0)return i.set(1,1,1),e.identity(),this;let a=as.set(n[0],n[1],n[2]).length();const o=as.set(n[4],n[5],n[6]).length(),l=as.set(n[8],n[9],n[10]).length();s<0&&(a=-a),xi.copy(this);const h=1/a,c=1/o,d=1/l;return xi.elements[0]*=h,xi.elements[1]*=h,xi.elements[2]*=h,xi.elements[4]*=c,xi.elements[5]*=c,xi.elements[6]*=c,xi.elements[8]*=d,xi.elements[9]*=d,xi.elements[10]*=d,e.setFromRotationMatrix(xi),i.x=a,i.y=o,i.z=l,this}makePerspective(t,e,i,n,s,a,o=Bi,l=!1){const h=this.elements,c=2*s/(e-t),d=2*s/(i-n),u=(e+t)/(e-t),f=(i+n)/(i-n);let p,x;if(l)p=s/(a-s),x=a*s/(a-s);else if(o===Bi)p=-(a+s)/(a-s),x=-2*a*s/(a-s);else if(o===Hr)p=-a/(a-s),x=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=u,h[12]=0,h[1]=0,h[5]=d,h[9]=f,h[13]=0,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,e,i,n,s,a,o=Bi,l=!1){const h=this.elements,c=2/(e-t),d=2/(i-n),u=-(e+t)/(e-t),f=-(i+n)/(i-n);let p,x;if(l)p=1/(a-s),x=a/(a-s);else if(o===Bi)p=-2/(a-s),x=-(a+s)/(a-s);else if(o===Hr)p=-1/(a-s),x=-s/(a-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=0,h[12]=u,h[1]=0,h[5]=d,h[9]=0,h[13]=f,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<16;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<16;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t[e+9]=i[9],t[e+10]=i[10],t[e+11]=i[11],t[e+12]=i[12],t[e+13]=i[13],t[e+14]=i[14],t[e+15]=i[15],t}};const as=new U,xi=new ue,em=new U(0,0,0),im=new U(1,1,1),pn=new U,jr=new U,ti=new U,Nc=new ue,Fc=new In;let Ln=class Zd{constructor(t=0,e=0,i=0,n=Zd.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=i,this._order=n}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,i,n=this._order){return this._x=t,this._y=e,this._z=i,this._order=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,i=!0){const n=t.elements,s=n[0],a=n[4],o=n[8],l=n[1],h=n[5],c=n[9],d=n[2],u=n[6],f=n[10];switch(e){case"XYZ":this._y=Math.asin(Wt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-c,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(u,h),this._z=0);break;case"YXZ":this._x=Math.asin(-Wt(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Wt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-a,h)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Wt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(u,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,h));break;case"YZX":this._z=Math.asin(Wt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-c,h),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Wt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(u,h),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-c,f),this._y=0);break;default:Lt("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,i){return Nc.makeRotationFromQuaternion(t),this.setFromRotationMatrix(Nc,e,i)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return Fc.setFromEuler(this),this.setFromQuaternion(Fc,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ln.DEFAULT_ORDER="XYZ";let ec=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},nm=0;const Uc=new U,os=new In,Xi=new ue,ta=new U,cr=new U,sm=new U,rm=new In,zc=new U(1,0,0),Oc=new U(0,1,0),kc=new U(0,0,1),Bc={type:"added"},am={type:"removed"},ls={type:"childadded",child:null},zo={type:"childremoved",child:null};let Pi=class eo extends Nn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:nm++}),this.uuid=rr(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=eo.DEFAULT_UP.clone();const t=new U,e=new Ln,i=new In,n=new U(1,1,1);function s(){i.setFromEuler(e,!1)}function a(){e.setFromQuaternion(i,void 0,!1)}e._onChange(s),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:n},modelViewMatrix:{value:new ue},normalMatrix:{value:new Ot}}),this.matrix=new ue,this.matrixWorld=new ue,this.matrixAutoUpdate=eo.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=eo.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ec,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return os.setFromAxisAngle(t,e),this.quaternion.multiply(os),this}rotateOnWorldAxis(t,e){return os.setFromAxisAngle(t,e),this.quaternion.premultiply(os),this}rotateX(t){return this.rotateOnAxis(zc,t)}rotateY(t){return this.rotateOnAxis(Oc,t)}rotateZ(t){return this.rotateOnAxis(kc,t)}translateOnAxis(t,e){return Uc.copy(t).applyQuaternion(this.quaternion),this.position.add(Uc.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(zc,t)}translateY(t){return this.translateOnAxis(Oc,t)}translateZ(t){return this.translateOnAxis(kc,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Xi.copy(this.matrixWorld).invert())}lookAt(t,e,i){t.isVector3?ta.copy(t):ta.set(t,e,i);const n=this.parent;this.updateWorldMatrix(!0,!1),cr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Xi.lookAt(cr,ta,this.up):Xi.lookAt(ta,cr,this.up),this.quaternion.setFromRotationMatrix(Xi),n&&(Xi.extractRotation(n.matrixWorld),os.setFromRotationMatrix(Xi),this.quaternion.premultiply(os.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(Zt("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Bc),ls.child=t,this.dispatchEvent(ls),ls.child=null):Zt("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(am),zo.child=t,this.dispatchEvent(zo),zo.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Xi.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Xi.multiply(t.parent.matrixWorld)),t.applyMatrix4(Xi),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Bc),ls.child=t,this.dispatchEvent(ls),ls.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let i=0,n=this.children.length;i<n;i++){const a=this.children[i].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,i=[]){this[t]===e&&i.push(this);const n=this.children;for(let s=0,a=n.length;s<a;s++)n[s].getObjectsByProperty(t,e,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(cr,t,sm),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(cr,rm,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,i=t.y,n=t.z,s=this.matrix.elements;s[12]+=e-s[0]*e-s[4]*i-s[8]*n,s[13]+=i-s[1]*e-s[5]*i-s[9]*n,s[14]+=n-s[2]*e-s[6]*i-s[10]*n}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].updateMatrixWorld(t)}updateWorldMatrix(t,e,i=!1){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),e===!0){const s=this.children;for(let a=0,o=s.length;a<o;a++)s[a].updateWorldMatrix(!1,!0,i)}}toJSON(t){const e=t===void 0||typeof t=="string",i={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const n={};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.castShadow===!0&&(n.castShadow=!0),this.receiveShadow===!0&&(n.receiveShadow=!0),this.visible===!1&&(n.visible=!1),this.frustumCulled===!1&&(n.frustumCulled=!1),this.renderOrder!==0&&(n.renderOrder=this.renderOrder),this.static!==!1&&(n.static=this.static),Object.keys(this.userData).length>0&&(n.userData=this.userData),n.layers=this.layers.mask,n.matrix=this.matrix.toArray(),n.up=this.up.toArray(),this.pivot!==null&&(n.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(n.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(n.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(n.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(n.type="InstancedMesh",n.count=this.count,n.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(n.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(n.type="BatchedMesh",n.perObjectFrustumCulled=this.perObjectFrustumCulled,n.sortObjects=this.sortObjects,n.drawRanges=this._drawRanges,n.reservedRanges=this._reservedRanges,n.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),n.instanceInfo=this._instanceInfo.map(o=>({...o})),n.availableInstanceIds=this._availableInstanceIds.slice(),n.availableGeometryIds=this._availableGeometryIds.slice(),n.nextIndexStart=this._nextIndexStart,n.nextVertexStart=this._nextVertexStart,n.geometryCount=this._geometryCount,n.maxInstanceCount=this._maxInstanceCount,n.maxVertexCount=this._maxVertexCount,n.maxIndexCount=this._maxIndexCount,n.geometryInitialized=this._geometryInitialized,n.matricesTexture=this._matricesTexture.toJSON(t),n.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(n.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(n.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(n.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?n.background=this.background.toJSON():this.background.isTexture&&(n.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(n.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){n.geometry=s(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let h=0,c=l.length;h<c;h++){const d=l[h];s(t.shapes,d)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(n.bindMode=this.bindMode,n.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),n.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(s(t.materials,this.material[l]));n.material=o}else n.material=s(t.materials,this.material);if(this.children.length>0){n.children=[];for(let o=0;o<this.children.length;o++)n.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){n.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];n.animations.push(s(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),h=a(t.textures),c=a(t.images),d=a(t.shapes),u=a(t.skeletons),f=a(t.animations),p=a(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),c.length>0&&(i.images=c),d.length>0&&(i.shapes=d),u.length>0&&(i.skeletons=u),f.length>0&&(i.animations=f),p.length>0&&(i.nodes=p)}return i.object=n,i;function a(o){const l=[];for(const h in o){const c=o[h];delete c.metadata,l.push(c)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let i=0;i<t.children.length;i++){const n=t.children[i];this.add(n.clone())}return this}};Pi.DEFAULT_UP=new U(0,1,0);Pi.DEFAULT_MATRIX_AUTO_UPDATE=!0;Pi.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;let Xs=class extends Pi{constructor(){super(),this.isGroup=!0,this.type="Group"}};const om={type:"move"};class Oo{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Xs,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Xs,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new U,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new U),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Xs,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new U,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new U,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const i of t.hand.values())this._getHandJoint(e,i)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,i){let n=null,s=null,a=null;const o=this._targetRay,l=this._grip,h=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(h&&t.hand){a=!0;for(const x of t.hand.values()){const g=e.getJointPose(x,i),m=this._getHandJoint(h,x);g!==null&&(m.matrix.fromArray(g.transform.matrix),m.matrix.decompose(m.position,m.rotation,m.scale),m.matrixWorldNeedsUpdate=!0,m.jointRadius=g.radius),m.visible=g!==null}const c=h.joints["index-finger-tip"],d=h.joints["thumb-tip"],u=c.position.distanceTo(d.position),f=.02,p=.005;h.inputState.pinching&&u>f+p?(h.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!h.inputState.pinching&&u<=f-p&&(h.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(s=e.getPose(t.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:t,target:this})));o!==null&&(n=e.getPose(t.targetRaySpace,i),n===null&&s!==null&&(n=s),n!==null&&(o.matrix.fromArray(n.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,n.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(n.linearVelocity)):o.hasLinearVelocity=!1,n.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(n.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(om)))}return o!==null&&(o.visible=n!==null),l!==null&&(l.visible=s!==null),h!==null&&(h.visible=a!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const i=new Xs;i.matrixAutoUpdate=!1,i.visible=!1,t.joints[e.jointName]=i,t.add(i)}return t.joints[e.jointName]}}const Kd={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},mn={h:0,s:0,l:0},ea={h:0,s:0,l:0};function ko(r,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?r+(t-r)*6*e:e<1/2?t:e<2/3?r+(t-r)*6*(2/3-e):r}let Ft=class{constructor(t,e,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,i)}set(t,e,i){if(e===void 0&&i===void 0){const n=t;n&&n.isColor?this.copy(n):typeof n=="number"?this.setHex(n):typeof n=="string"&&this.setStyle(n)}else this.setRGB(t,e,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=si){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,$t.colorSpaceToWorking(this,e),this}setRGB(t,e,i,n=$t.workingColorSpace){return this.r=t,this.g=e,this.b=i,$t.colorSpaceToWorking(this,n),this}setHSL(t,e,i,n=$t.workingColorSpace){if(t=jh(t,1),e=Wt(e,0,1),i=Wt(i,0,1),e===0)this.r=this.g=this.b=i;else{const s=i<=.5?i*(1+e):i+e-i*e,a=2*i-s;this.r=ko(a,s,t+1/3),this.g=ko(a,s,t),this.b=ko(a,s,t-1/3)}return $t.colorSpaceToWorking(this,n),this}setStyle(t,e=si){function i(s){s!==void 0&&parseFloat(s)<1&&Lt("Color: Alpha component of "+t+" will be ignored.")}let n;if(n=/^(\w+)\(([^\)]*)\)/.exec(t)){let s;const a=n[1],o=n[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:Lt("Color: Unknown color model "+t)}}else if(n=/^\#([A-Fa-f\d]+)$/.exec(t)){const s=n[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(s,16),e);Lt("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=si){const i=Kd[t.toLowerCase()];return i!==void 0?this.setHex(i,e):Lt("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=rn(t.r),this.g=rn(t.g),this.b=rn(t.b),this}copyLinearToSRGB(t){return this.r=Zs(t.r),this.g=Zs(t.g),this.b=Zs(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=si){return $t.workingToColorSpace(Be.copy(this),t),Math.round(Wt(Be.r*255,0,255))*65536+Math.round(Wt(Be.g*255,0,255))*256+Math.round(Wt(Be.b*255,0,255))}getHexString(t=si){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=$t.workingColorSpace){$t.workingToColorSpace(Be.copy(this),e);const i=Be.r,n=Be.g,s=Be.b,a=Math.max(i,n,s),o=Math.min(i,n,s);let l,h;const c=(o+a)/2;if(o===a)l=0,h=0;else{const d=a-o;switch(h=c<=.5?d/(a+o):d/(2-a-o),a){case i:l=(n-s)/d+(n<s?6:0);break;case n:l=(s-i)/d+2;break;case s:l=(i-n)/d+4;break}l/=6}return t.h=l,t.s=h,t.l=c,t}getRGB(t,e=$t.workingColorSpace){return $t.workingToColorSpace(Be.copy(this),e),t.r=Be.r,t.g=Be.g,t.b=Be.b,t}getStyle(t=si){$t.workingToColorSpace(Be.copy(this),t);const e=Be.r,i=Be.g,n=Be.b;return t!==si?`color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${n.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(i*255)},${Math.round(n*255)})`}offsetHSL(t,e,i){return this.getHSL(mn),this.setHSL(mn.h+t,mn.s+e,mn.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,i){return this.r=t.r+(e.r-t.r)*i,this.g=t.g+(e.g-t.g)*i,this.b=t.b+(e.b-t.b)*i,this}lerpHSL(t,e){this.getHSL(mn),t.getHSL(ea);const i=Fr(mn.h,ea.h,e),n=Fr(mn.s,ea.s,e),s=Fr(mn.l,ea.l,e);return this.setHSL(i,n,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,i=this.g,n=this.b,s=t.elements;return this.r=s[0]*e+s[3]*i+s[6]*n,this.g=s[1]*e+s[4]*i+s[7]*n,this.b=s[2]*e+s[5]*i+s[8]*n,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}};const Be=new Ft;Ft.NAMES=Kd;class ic{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new Ft(t),this.density=e}clone(){return new ic(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class nc{constructor(t,e=1,i=1e3){this.isFog=!0,this.name="",this.color=new Ft(t),this.near=e,this.far=i}clone(){return new nc(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}let io=class extends Pi{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ln,this.environmentIntensity=1,this.environmentRotation=new Ln,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}};const _i=new U,qi=new U,Bo=new U,$i=new U,hs=new U,cs=new U,Vc=new U,Vo=new U,Go=new U,Ho=new U,Wo=new _e,Xo=new _e,qo=new _e;let ur=class Gs{constructor(t=new U,e=new U,i=new U){this.a=t,this.b=e,this.c=i}static getNormal(t,e,i,n){n.subVectors(i,e),_i.subVectors(t,e),n.cross(_i);const s=n.lengthSq();return s>0?n.multiplyScalar(1/Math.sqrt(s)):n.set(0,0,0)}static getBarycoord(t,e,i,n,s){_i.subVectors(n,e),qi.subVectors(i,e),Bo.subVectors(t,e);const a=_i.dot(_i),o=_i.dot(qi),l=_i.dot(Bo),h=qi.dot(qi),c=qi.dot(Bo),d=a*h-o*o;if(d===0)return s.set(0,0,0),null;const u=1/d,f=(h*l-o*c)*u,p=(a*c-o*l)*u;return s.set(1-f-p,p,f)}static containsPoint(t,e,i,n){return this.getBarycoord(t,e,i,n,$i)===null?!1:$i.x>=0&&$i.y>=0&&$i.x+$i.y<=1}static getInterpolation(t,e,i,n,s,a,o,l){return this.getBarycoord(t,e,i,n,$i)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,$i.x),l.addScaledVector(a,$i.y),l.addScaledVector(o,$i.z),l)}static getInterpolatedAttribute(t,e,i,n,s,a){return Wo.setScalar(0),Xo.setScalar(0),qo.setScalar(0),Wo.fromBufferAttribute(t,e),Xo.fromBufferAttribute(t,i),qo.fromBufferAttribute(t,n),a.setScalar(0),a.addScaledVector(Wo,s.x),a.addScaledVector(Xo,s.y),a.addScaledVector(qo,s.z),a}static isFrontFacing(t,e,i,n){return _i.subVectors(i,e),qi.subVectors(t,e),_i.cross(qi).dot(n)<0}set(t,e,i){return this.a.copy(t),this.b.copy(e),this.c.copy(i),this}setFromPointsAndIndices(t,e,i,n){return this.a.copy(t[e]),this.b.copy(t[i]),this.c.copy(t[n]),this}setFromAttributeAndIndices(t,e,i,n){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return _i.subVectors(this.c,this.b),qi.subVectors(this.a,this.b),_i.cross(qi).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Gs.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return Gs.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,i,n,s){return Gs.getInterpolation(t,this.a,this.b,this.c,e,i,n,s)}containsPoint(t){return Gs.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Gs.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const i=this.a,n=this.b,s=this.c;let a,o;hs.subVectors(n,i),cs.subVectors(s,i),Vo.subVectors(t,i);const l=hs.dot(Vo),h=cs.dot(Vo);if(l<=0&&h<=0)return e.copy(i);Go.subVectors(t,n);const c=hs.dot(Go),d=cs.dot(Go);if(c>=0&&d<=c)return e.copy(n);const u=l*d-c*h;if(u<=0&&l>=0&&c<=0)return a=l/(l-c),e.copy(i).addScaledVector(hs,a);Ho.subVectors(t,s);const f=hs.dot(Ho),p=cs.dot(Ho);if(p>=0&&f<=p)return e.copy(s);const x=f*h-l*p;if(x<=0&&h>=0&&p<=0)return o=h/(h-p),e.copy(i).addScaledVector(cs,o);const g=c*p-f*d;if(g<=0&&d-c>=0&&f-p>=0)return Vc.subVectors(s,n),o=(d-c)/(d-c+(f-p)),e.copy(n).addScaledVector(Vc,o);const m=1/(g+x+u);return a=x*m,o=u*m,e.copy(i).addScaledVector(hs,a).addScaledVector(cs,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},ts=class{constructor(t=new U(1/0,1/0,1/0),e=new U(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e+=3)this.expandByPoint(yi.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,i=t.count;e<i;e++)this.expandByPoint(yi.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const i=yi.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const i=t.geometry;if(i!==void 0){const s=i.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,yi):yi.fromBufferAttribute(s,a),yi.applyMatrix4(t.matrixWorld),this.expandByPoint(yi);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),ia.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),ia.copy(i.boundingBox)),ia.applyMatrix4(t.matrixWorld),this.union(ia)}const n=t.children;for(let s=0,a=n.length;s<a;s++)this.expandByObject(n[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,yi),yi.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,i;return t.normal.x>0?(e=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),e<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(dr),na.subVectors(this.max,dr),us.subVectors(t.a,dr),ds.subVectors(t.b,dr),fs.subVectors(t.c,dr),gn.subVectors(ds,us),xn.subVectors(fs,ds),zn.subVectors(us,fs);let e=[0,-gn.z,gn.y,0,-xn.z,xn.y,0,-zn.z,zn.y,gn.z,0,-gn.x,xn.z,0,-xn.x,zn.z,0,-zn.x,-gn.y,gn.x,0,-xn.y,xn.x,0,-zn.y,zn.x,0];return!$o(e,us,ds,fs,na)||(e=[1,0,0,0,1,0,0,0,1],!$o(e,us,ds,fs,na))?!1:(sa.crossVectors(gn,xn),e=[sa.x,sa.y,sa.z],$o(e,us,ds,fs,na))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,yi).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(yi).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(Yi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),Yi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),Yi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),Yi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),Yi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),Yi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),Yi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),Yi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(Yi),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}};const Yi=[new U,new U,new U,new U,new U,new U,new U,new U],yi=new U,ia=new ts,us=new U,ds=new U,fs=new U,gn=new U,xn=new U,zn=new U,dr=new U,na=new U,sa=new U,On=new U;function $o(r,t,e,i,n){for(let s=0,a=r.length-3;s<=a;s+=3){On.fromArray(r,s);const o=n.x*Math.abs(On.x)+n.y*Math.abs(On.y)+n.z*Math.abs(On.z),l=t.dot(On),h=e.dot(On),c=i.dot(On);if(Math.max(-Math.max(l,h,c),Math.min(l,h,c))>o)return!1}return!0}const Me=new U,ra=new Nt;let lm=0,Ai=class extends Nn{constructor(t,e,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:lm++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=i,this.usage=Tc,this.updateRanges=[],this.gpuType=wi,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,i){t*=this.itemSize,i*=e.itemSize;for(let n=0,s=this.itemSize;n<s;n++)this.array[t+n]=e.array[i+n];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,i=this.count;e<i;e++)ra.fromBufferAttribute(this,e),ra.applyMatrix3(t),this.setXY(e,ra.x,ra.y);else if(this.itemSize===3)for(let e=0,i=this.count;e<i;e++)Me.fromBufferAttribute(this,e),Me.applyMatrix3(t),this.setXYZ(e,Me.x,Me.y,Me.z);return this}applyMatrix4(t){for(let e=0,i=this.count;e<i;e++)Me.fromBufferAttribute(this,e),Me.applyMatrix4(t),this.setXYZ(e,Me.x,Me.y,Me.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)Me.fromBufferAttribute(this,e),Me.applyNormalMatrix(t),this.setXYZ(e,Me.x,Me.y,Me.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)Me.fromBufferAttribute(this,e),Me.transformDirection(t),this.setXYZ(e,Me.x,Me.y,Me.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let i=this.array[t*this.itemSize+e];return this.normalized&&(i=Vs(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=Xe(i,this.array)),this.array[t*this.itemSize+e]=i,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Vs(e,this.array)),e}setX(t,e){return this.normalized&&(e=Xe(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Vs(e,this.array)),e}setY(t,e){return this.normalized&&(e=Xe(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Vs(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Xe(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Vs(e,this.array)),e}setW(t,e){return this.normalized&&(e=Xe(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,i){return t*=this.itemSize,this.normalized&&(e=Xe(e,this.array),i=Xe(i,this.array)),this.array[t+0]=e,this.array[t+1]=i,this}setXYZ(t,e,i,n){return t*=this.itemSize,this.normalized&&(e=Xe(e,this.array),i=Xe(i,this.array),n=Xe(n,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this}setXYZW(t,e,i,n,s){return t*=this.itemSize,this.normalized&&(e=Xe(e,this.array),i=Xe(i,this.array),n=Xe(n,this.array),s=Xe(s,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Tc&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}},Jd=class extends Ai{constructor(t,e,i){super(new Uint16Array(t),e,i)}},Qd=class extends Ai{constructor(t,e,i){super(new Uint32Array(t),e,i)}},pi=class extends Ai{constructor(t,e,i){super(new Float32Array(t),e,i)}};const hm=new ts,fr=new U,Yo=new U;let $r=class{constructor(t=new U,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const i=this.center;e!==void 0?i.copy(e):hm.setFromPoints(t).getCenter(i);let n=0;for(let s=0,a=t.length;s<a;s++)n=Math.max(n,i.distanceToSquared(t[s]));return this.radius=Math.sqrt(n),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const i=this.center.distanceToSquared(t);return e.copy(t),i>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;fr.subVectors(t,this.center);const e=fr.lengthSq();if(e>this.radius*this.radius){const i=Math.sqrt(e),n=(i-this.radius)*.5;this.center.addScaledVector(fr,n/i),this.radius+=n}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(Yo.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(fr.copy(t.center).add(Yo)),this.expandByPoint(fr.copy(t.center).sub(Yo))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},cm=0;const hi=new ue,Zo=new Pi,ps=new U,ei=new ts,pr=new ts,Pe=new U;let Fn=class jd extends Nn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:cm++}),this.uuid=rr(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Cp(t)?Qd:Jd)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,i=0){this.groups.push({start:t,count:e,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const s=new Ot().getNormalMatrix(t);i.applyNormalMatrix(s),i.needsUpdate=!0}const n=this.attributes.tangent;return n!==void 0&&(n.transformDirection(t),n.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return hi.makeRotationFromQuaternion(t),this.applyMatrix4(hi),this}rotateX(t){return hi.makeRotationX(t),this.applyMatrix4(hi),this}rotateY(t){return hi.makeRotationY(t),this.applyMatrix4(hi),this}rotateZ(t){return hi.makeRotationZ(t),this.applyMatrix4(hi),this}translate(t,e,i){return hi.makeTranslation(t,e,i),this.applyMatrix4(hi),this}scale(t,e,i){return hi.makeScale(t,e,i),this.applyMatrix4(hi),this}lookAt(t){return Zo.lookAt(t),Zo.updateMatrix(),this.applyMatrix4(Zo.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ps).negate(),this.translate(ps.x,ps.y,ps.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const i=[];for(let n=0,s=t.length;n<s;n++){const a=t[n];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new pi(i,3))}else{const i=Math.min(t.length,e.count);for(let n=0;n<i;n++){const s=t[n];e.setXYZ(n,s.x,s.y,s.z||0)}t.length>e.count&&Lt("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ts);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Zt("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new U(-1/0,-1/0,-1/0),new U(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let i=0,n=e.length;i<n;i++){const s=e[i];ei.setFromBufferAttribute(s),this.morphTargetsRelative?(Pe.addVectors(this.boundingBox.min,ei.min),this.boundingBox.expandByPoint(Pe),Pe.addVectors(this.boundingBox.max,ei.max),this.boundingBox.expandByPoint(Pe)):(this.boundingBox.expandByPoint(ei.min),this.boundingBox.expandByPoint(ei.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Zt('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new $r);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Zt("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new U,1/0);return}if(t){const i=this.boundingSphere.center;if(ei.setFromBufferAttribute(t),e)for(let s=0,a=e.length;s<a;s++){const o=e[s];pr.setFromBufferAttribute(o),this.morphTargetsRelative?(Pe.addVectors(ei.min,pr.min),ei.expandByPoint(Pe),Pe.addVectors(ei.max,pr.max),ei.expandByPoint(Pe)):(ei.expandByPoint(pr.min),ei.expandByPoint(pr.max))}ei.getCenter(i);let n=0;for(let s=0,a=t.count;s<a;s++)Pe.fromBufferAttribute(t,s),n=Math.max(n,i.distanceToSquared(Pe));if(e)for(let s=0,a=e.length;s<a;s++){const o=e[s],l=this.morphTargetsRelative;for(let h=0,c=o.count;h<c;h++)Pe.fromBufferAttribute(o,h),l&&(ps.fromBufferAttribute(t,h),Pe.add(ps)),n=Math.max(n,i.distanceToSquared(Pe))}this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&Zt('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){Zt("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=e.position,n=e.normal,s=e.uv;let a=this.getAttribute("tangent");(a===void 0||a.count!==i.count)&&(a=new Ai(new Float32Array(4*i.count),4),this.setAttribute("tangent",a));const o=[],l=[];for(let _=0;_<i.count;_++)o[_]=new U,l[_]=new U;const h=new U,c=new U,d=new U,u=new Nt,f=new Nt,p=new Nt,x=new U,g=new U;function m(_,T,C){h.fromBufferAttribute(i,_),c.fromBufferAttribute(i,T),d.fromBufferAttribute(i,C),u.fromBufferAttribute(s,_),f.fromBufferAttribute(s,T),p.fromBufferAttribute(s,C),c.sub(h),d.sub(h),f.sub(u),p.sub(u);const P=1/(f.x*p.y-p.x*f.y);isFinite(P)&&(x.copy(c).multiplyScalar(p.y).addScaledVector(d,-f.y).multiplyScalar(P),g.copy(d).multiplyScalar(f.x).addScaledVector(c,-p.x).multiplyScalar(P),o[_].add(x),o[T].add(x),o[C].add(x),l[_].add(g),l[T].add(g),l[C].add(g))}let M=this.groups;M.length===0&&(M=[{start:0,count:t.count}]);for(let _=0,T=M.length;_<T;++_){const C=M[_],P=C.start,D=C.count;for(let O=P,H=P+D;O<H;O+=3)m(t.getX(O+0),t.getX(O+1),t.getX(O+2))}const E=new U,v=new U,w=new U,b=new U;function A(_){w.fromBufferAttribute(n,_),b.copy(w);const T=o[_];E.copy(T),E.sub(w.multiplyScalar(w.dot(T))).normalize(),v.crossVectors(b,T);const P=v.dot(l[_])<0?-1:1;a.setXYZW(_,E.x,E.y,E.z,P)}for(let _=0,T=M.length;_<T;++_){const C=M[_],P=C.start,D=C.count;for(let O=P,H=P+D;O<H;O+=3)A(t.getX(O+0)),A(t.getX(O+1)),A(t.getX(O+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==e.count)i=new Ai(new Float32Array(e.count*3),3),this.setAttribute("normal",i);else for(let u=0,f=i.count;u<f;u++)i.setXYZ(u,0,0,0);const n=new U,s=new U,a=new U,o=new U,l=new U,h=new U,c=new U,d=new U;if(t)for(let u=0,f=t.count;u<f;u+=3){const p=t.getX(u+0),x=t.getX(u+1),g=t.getX(u+2);n.fromBufferAttribute(e,p),s.fromBufferAttribute(e,x),a.fromBufferAttribute(e,g),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),o.fromBufferAttribute(i,p),l.fromBufferAttribute(i,x),h.fromBufferAttribute(i,g),o.add(c),l.add(c),h.add(c),i.setXYZ(p,o.x,o.y,o.z),i.setXYZ(x,l.x,l.y,l.z),i.setXYZ(g,h.x,h.y,h.z)}else for(let u=0,f=e.count;u<f;u+=3)n.fromBufferAttribute(e,u+0),s.fromBufferAttribute(e,u+1),a.fromBufferAttribute(e,u+2),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),i.setXYZ(u+0,c.x,c.y,c.z),i.setXYZ(u+1,c.x,c.y,c.z),i.setXYZ(u+2,c.x,c.y,c.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,i=t.count;e<i;e++)Pe.fromBufferAttribute(t,e),Pe.normalize(),t.setXYZ(e,Pe.x,Pe.y,Pe.z)}toNonIndexed(){function t(o,l){const h=o.array,c=o.itemSize,d=o.normalized,u=new h.constructor(l.length*c);let f=0,p=0;for(let x=0,g=l.length;x<g;x++){o.isInterleavedBufferAttribute?f=l[x]*o.data.stride+o.offset:f=l[x]*c;for(let m=0;m<c;m++)u[p++]=h[f++]}return new Ai(u,c,d)}if(this.index===null)return Lt("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new jd,i=this.index.array,n=this.attributes;for(const o in n){const l=n[o],h=t(l,i);e.setAttribute(o,h)}const s=this.morphAttributes;for(const o in s){const l=[],h=s[o];for(let c=0,d=h.length;c<d;c++){const u=h[c],f=t(u,i);l.push(f)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const h=a[o];e.addGroup(h.start,h.count,h.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const l=this.parameters;for(const h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const i=this.attributes;for(const l in i){const h=i[l];t.data.attributes[l]=h.toJSON(t.data)}const n={};let s=!1;for(const l in this.morphAttributes){const h=this.morphAttributes[l],c=[];for(let d=0,u=h.length;d<u;d++){const f=h[d];c.push(f.toJSON(t.data))}c.length>0&&(n[l]=c,s=!0)}s&&(t.data.morphAttributes=n,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const i=t.index;i!==null&&this.setIndex(i.clone());const n=t.attributes;for(const h in n){const c=n[h];this.setAttribute(h,c.clone(e))}const s=t.morphAttributes;for(const h in s){const c=[],d=s[h];for(let u=0,f=d.length;u<f;u++)c.push(d[u].clone(e));this.morphAttributes[h]=c}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let h=0,c=a.length;h<c;h++){const d=a[h];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}},um=0,ar=class extends Nn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:um++}),this.uuid=rr(),this.name="",this.type="Material",this.blending=$s,this.side=Dn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Bl,this.blendDst=Vl,this.blendEquation=qn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ft(0,0,0),this.blendAlpha=0,this.depthFunc=tr,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ec,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ss,this.stencilZFail=ss,this.stencilZPass=ss,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const i=t[e];if(i===void 0){Lt(`Material: parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Lt(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}n&&n.isColor?n.set(i):n&&n.isVector2&&i&&i.isVector2||n&&n.isEuler&&i&&i.isEuler||n&&n.isVector3&&i&&i.isVector3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==$s&&(i.blending=this.blending),this.side!==Dn&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==Bl&&(i.blendSrc=this.blendSrc),this.blendDst!==Vl&&(i.blendDst=this.blendDst),this.blendEquation!==qn&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==tr&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Ec&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ss&&(i.stencilFail=this.stencilFail),this.stencilZFail!==ss&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==ss&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function n(s){const a=[];for(const o in s){const l=s[o];delete l.metadata,a.push(l)}return a}if(e){const s=n(t.textures),a=n(t.images);s.length>0&&(i.textures=s),a.length>0&&(i.images=a)}return i}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new Ft().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new Nt().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Nt().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let i=null;if(e!==null){const n=e.length;i=new Array(n);for(let s=0;s!==n;++s)i[s]=e[s].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}};const Zi=new U,Ko=new U,aa=new U,_n=new U,Jo=new U,oa=new U,Qo=new U;let sc=class{constructor(t=new U,e=new U(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Zi)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const i=e.dot(this.direction);return i<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=Zi.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(Zi.copy(this.origin).addScaledVector(this.direction,e),Zi.distanceToSquared(t))}distanceSqToSegment(t,e,i,n){Ko.copy(t).add(e).multiplyScalar(.5),aa.copy(e).sub(t).normalize(),_n.copy(this.origin).sub(Ko);const s=t.distanceTo(e)*.5,a=-this.direction.dot(aa),o=_n.dot(this.direction),l=-_n.dot(aa),h=_n.lengthSq(),c=Math.abs(1-a*a);let d,u,f,p;if(c>0)if(d=a*l-o,u=a*o-l,p=s*c,d>=0)if(u>=-p)if(u<=p){const x=1/c;d*=x,u*=x,f=d*(d+a*u+2*o)+u*(a*d+u+2*l)+h}else u=s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u=-s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u<=-p?(d=Math.max(0,-(-a*s+o)),u=d>0?-s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h):u<=p?(d=0,u=Math.min(Math.max(-s,-l),s),f=u*(u+2*l)+h):(d=Math.max(0,-(a*s+o)),u=d>0?s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h);else u=a>0?-s:s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;return i&&i.copy(this.origin).addScaledVector(this.direction,d),n&&n.copy(Ko).addScaledVector(aa,u),f}intersectSphere(t,e){Zi.subVectors(t.center,this.origin);const i=Zi.dot(this.direction),n=Zi.dot(Zi)-i*i,s=t.radius*t.radius;if(n>s)return null;const a=Math.sqrt(s-n),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(t.normal)+t.constant)/e;return i>=0?i:null}intersectPlane(t,e){const i=this.distanceToPlane(t);return i===null?null:this.at(i,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let i,n,s,a,o,l;const h=1/this.direction.x,c=1/this.direction.y,d=1/this.direction.z,u=this.origin;return h>=0?(i=(t.min.x-u.x)*h,n=(t.max.x-u.x)*h):(i=(t.max.x-u.x)*h,n=(t.min.x-u.x)*h),c>=0?(s=(t.min.y-u.y)*c,a=(t.max.y-u.y)*c):(s=(t.max.y-u.y)*c,a=(t.min.y-u.y)*c),i>a||s>n||((s>i||isNaN(i))&&(i=s),(a<n||isNaN(n))&&(n=a),d>=0?(o=(t.min.z-u.z)*d,l=(t.max.z-u.z)*d):(o=(t.max.z-u.z)*d,l=(t.min.z-u.z)*d),i>l||o>n)||((o>i||i!==i)&&(i=o),(l<n||n!==n)&&(n=l),n<0)?null:this.at(i>=0?i:n,e)}intersectsBox(t){return this.intersectBox(t,Zi)!==null}intersectTriangle(t,e,i,n,s){Jo.subVectors(e,t),oa.subVectors(i,t),Qo.crossVectors(Jo,oa);let a=this.direction.dot(Qo),o;if(a>0){if(n)return null;o=1}else if(a<0)o=-1,a=-a;else return null;_n.subVectors(this.origin,t);const l=o*this.direction.dot(oa.crossVectors(_n,oa));if(l<0)return null;const h=o*this.direction.dot(Jo.cross(_n));if(h<0||l+h>a)return null;const c=-o*_n.dot(Qo);return c<0?null:this.at(c/a,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},tf=class extends ar{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ft(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ln,this.combine=Oh,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}};const Gc=new ue,kn=new sc,la=new $r,Hc=new U,ha=new U,ca=new U,ua=new U,jo=new U,da=new U,Wc=new U,fa=new U;let Se=class extends Pi{constructor(t=new Fn,e=new tf){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=n.length;s<a;s++){const o=n[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(t,e){const i=this.geometry,n=i.attributes.position,s=i.morphAttributes.position,a=i.morphTargetsRelative;e.fromBufferAttribute(n,t);const o=this.morphTargetInfluences;if(s&&o){da.set(0,0,0);for(let l=0,h=s.length;l<h;l++){const c=o[l],d=s[l];c!==0&&(jo.fromBufferAttribute(d,t),a?da.addScaledVector(jo,c):da.addScaledVector(jo.sub(e),c))}e.add(da)}return e}raycast(t,e){const i=this.geometry,n=this.material,s=this.matrixWorld;n!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),la.copy(i.boundingSphere),la.applyMatrix4(s),kn.copy(t.ray).recast(t.near),!(la.containsPoint(kn.origin)===!1&&(kn.intersectSphere(la,Hc)===null||kn.origin.distanceToSquared(Hc)>(t.far-t.near)**2))&&(Gc.copy(s).invert(),kn.copy(t.ray).applyMatrix4(Gc),!(i.boundingBox!==null&&kn.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,e,kn)))}_computeIntersections(t,e,i){let n;const s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,h=s.attributes.uv,c=s.attributes.uv1,d=s.attributes.normal,u=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const g=u[p],m=a[g.materialIndex],M=Math.max(g.start,f.start),E=Math.min(o.count,Math.min(g.start+g.count,f.start+f.count));for(let v=M,w=E;v<w;v+=3){const b=o.getX(v),A=o.getX(v+1),_=o.getX(v+2);n=pa(this,m,t,i,h,c,d,b,A,_),n&&(n.faceIndex=Math.floor(v/3),n.face.materialIndex=g.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(o.count,f.start+f.count);for(let g=p,m=x;g<m;g+=3){const M=o.getX(g),E=o.getX(g+1),v=o.getX(g+2);n=pa(this,a,t,i,h,c,d,M,E,v),n&&(n.faceIndex=Math.floor(g/3),e.push(n))}}else if(l!==void 0)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const g=u[p],m=a[g.materialIndex],M=Math.max(g.start,f.start),E=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let v=M,w=E;v<w;v+=3){const b=v,A=v+1,_=v+2;n=pa(this,m,t,i,h,c,d,b,A,_),n&&(n.faceIndex=Math.floor(v/3),n.face.materialIndex=g.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(l.count,f.start+f.count);for(let g=p,m=x;g<m;g+=3){const M=g,E=g+1,v=g+2;n=pa(this,a,t,i,h,c,d,M,E,v),n&&(n.faceIndex=Math.floor(g/3),e.push(n))}}}};function dm(r,t,e,i,n,s,a,o){let l;if(t.side===Ue?l=i.intersectTriangle(a,s,n,!0,o):l=i.intersectTriangle(n,s,a,t.side===Dn,o),l===null)return null;fa.copy(o),fa.applyMatrix4(r.matrixWorld);const h=e.ray.origin.distanceTo(fa);return h<e.near||h>e.far?null:{distance:h,point:fa.clone(),object:r}}function pa(r,t,e,i,n,s,a,o,l,h){r.getVertexPosition(o,ha),r.getVertexPosition(l,ca),r.getVertexPosition(h,ua);const c=dm(r,t,e,i,ha,ca,ua,Wc);if(c){const d=new U;ur.getBarycoord(Wc,ha,ca,ua,d),n&&(c.uv=ur.getInterpolatedAttribute(n,o,l,h,d,new Nt)),s&&(c.uv1=ur.getInterpolatedAttribute(s,o,l,h,d,new Nt)),a&&(c.normal=ur.getInterpolatedAttribute(a,o,l,h,d,new U),c.normal.dot(i.direction)>0&&c.normal.multiplyScalar(-1));const u={a:o,b:l,c:h,normal:new U,materialIndex:0};ur.getNormal(ha,ca,ua,u.normal),c.face=u,c.barycoord=d}return c}class ef extends Ci{constructor(t=null,e=1,i=1,n,s,a,o,l,h=Ne,c=Ne,d,u){super(null,a,o,l,h,c,n,s,d,u),this.isDataTexture=!0,this.image={data:t,width:e,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Xc extends Ai{constructor(t,e,i,n=1){super(t,e,i),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=n}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const ms=new ue,qc=new ue,ma=[],$c=new ts,fm=new ue,mr=new Se,gr=new $r;class pm extends Se{constructor(t,e,i){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Xc(new Float32Array(i*16),16),this.instanceColor=null,this.morphTexture=null,this.count=i,this.boundingBox=null,this.boundingSphere=null;for(let n=0;n<i;n++)this.setMatrixAt(n,fm)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new ts),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,ms),$c.copy(t.boundingBox).applyMatrix4(ms),this.boundingBox.union($c)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new $r),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,ms),gr.copy(t.boundingSphere).applyMatrix4(ms),this.boundingSphere.union(gr)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const i=e.morphTargetInfluences,n=this.morphTexture.source.data.data,s=i.length+1,a=t*s+1;for(let o=0;o<i.length;o++)i[o]=n[a+o]}raycast(t,e){const i=this.matrixWorld,n=this.count;if(mr.geometry=this.geometry,mr.material=this.material,mr.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),gr.copy(this.boundingSphere),gr.applyMatrix4(i),t.ray.intersectsSphere(gr)!==!1))for(let s=0;s<n;s++){this.getMatrixAt(s,ms),qc.multiplyMatrices(i,ms),mr.matrixWorld=qc,mr.raycast(t,ma);for(let a=0,o=ma.length;a<o;a++){const l=ma[a];l.instanceId=s,l.object=this,e.push(l)}ma.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new Xc(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){const i=e.morphTargetInfluences,n=i.length+1;this.morphTexture===null&&(this.morphTexture=new ef(new Float32Array(n*this.count),n,this.count,$h,wi));const s=this.morphTexture.source.data.data;let a=0;for(let h=0;h<i.length;h++)a+=i[h];const o=this.geometry.morphTargetsRelative?1:1-a,l=n*t;return s[l]=o,s.set(i,l+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}const tl=new U,mm=new U,gm=new Ot;class En{constructor(t=new U(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,i,n){return this.normal.set(t,e,i),this.constant=n,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,i){const n=tl.subVectors(i,e).cross(mm.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(n,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e,i=!0){const n=t.delta(tl),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const a=-(t.start.dot(this.normal)+this.constant)/s;return i===!0&&(a<0||a>1)?null:e.copy(t.start).addScaledVector(n,a)}intersectsLine(t){const e=this.distanceToPoint(t.start),i=this.distanceToPoint(t.end);return e<0&&i>0||i<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const i=e||gm.getNormalMatrix(t),n=this.coplanarPoint(tl).applyMatrix4(t),s=this.normal.applyMatrix3(i).normalize();return this.constant=-n.dot(s),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Bn=new $r,xm=new Nt(.5,.5),ga=new U;class rc{constructor(t=new En,e=new En,i=new En,n=new En,s=new En,a=new En){this.planes=[t,e,i,n,s,a]}set(t,e,i,n,s,a){const o=this.planes;return o[0].copy(t),o[1].copy(e),o[2].copy(i),o[3].copy(n),o[4].copy(s),o[5].copy(a),this}copy(t){const e=this.planes;for(let i=0;i<6;i++)e[i].copy(t.planes[i]);return this}setFromProjectionMatrix(t,e=Bi,i=!1){const n=this.planes,s=t.elements,a=s[0],o=s[1],l=s[2],h=s[3],c=s[4],d=s[5],u=s[6],f=s[7],p=s[8],x=s[9],g=s[10],m=s[11],M=s[12],E=s[13],v=s[14],w=s[15];if(n[0].setComponents(h-a,f-c,m-p,w-M).normalize(),n[1].setComponents(h+a,f+c,m+p,w+M).normalize(),n[2].setComponents(h+o,f+d,m+x,w+E).normalize(),n[3].setComponents(h-o,f-d,m-x,w-E).normalize(),i)n[4].setComponents(l,u,g,v).normalize(),n[5].setComponents(h-l,f-u,m-g,w-v).normalize();else if(n[4].setComponents(h-l,f-u,m-g,w-v).normalize(),e===Bi)n[5].setComponents(h+l,f+u,m+g,w+v).normalize();else if(e===Hr)n[5].setComponents(l,u,g,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Bn.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Bn.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Bn)}intersectsSprite(t){Bn.center.set(0,0,0);const e=xm.distanceTo(t.center);return Bn.radius=.7071067811865476+e,Bn.applyMatrix4(t.matrixWorld),this.intersectsSphere(Bn)}intersectsSphere(t){const e=this.planes,i=t.center,n=-t.radius;for(let s=0;s<6;s++)if(e[s].distanceToPoint(i)<n)return!1;return!0}intersectsBox(t){const e=this.planes;for(let i=0;i<6;i++){const n=e[i];if(ga.x=n.normal.x>0?t.max.x:t.min.x,ga.y=n.normal.y>0?t.max.y:t.min.y,ga.z=n.normal.z>0?t.max.z:t.min.z,n.distanceToPoint(ga)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let i=0;i<6;i++)if(e[i].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class nf extends Ci{constructor(t=[],e=Kn,i,n,s,a,o,l,h,c){super(t,e,i,n,s,a,o,l,h,c),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class ir extends Ci{constructor(t,e,i=Hi,n,s,a,o=Ne,l=Ne,h,c=hn,d=1){if(c!==hn&&c!==Zn)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const u={width:t,height:e,depth:d};super(u,n,s,a,o,l,c,i,h),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new tc(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}class _m extends ir{constructor(t,e=Hi,i=Kn,n,s,a=Ne,o=Ne,l,h=hn){const c={width:t,height:t,depth:1},d=[c,c,c,c,c,c];super(t,t,e,i,n,s,a,o,l,h),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}}class sf extends Ci{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}}class es extends Fn{constructor(t=1,e=1,i=1,n=1,s=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:i,widthSegments:n,heightSegments:s,depthSegments:a};const o=this;n=Math.floor(n),s=Math.floor(s),a=Math.floor(a);const l=[],h=[],c=[],d=[];let u=0,f=0;p("z","y","x",-1,-1,i,e,t,a,s,0),p("z","y","x",1,-1,i,e,-t,a,s,1),p("x","z","y",1,1,t,i,e,n,a,2),p("x","z","y",1,-1,t,i,-e,n,a,3),p("x","y","z",1,-1,t,e,i,n,s,4),p("x","y","z",-1,-1,t,e,-i,n,s,5),this.setIndex(l),this.setAttribute("position",new pi(h,3)),this.setAttribute("normal",new pi(c,3)),this.setAttribute("uv",new pi(d,2));function p(x,g,m,M,E,v,w,b,A,_,T){const C=v/A,P=w/_,D=v/2,O=w/2,H=b/2,F=A+1,q=_+1;let G=0,J=0;const et=new U;for(let at=0;at<q;at++){const rt=at*P-O;for(let k=0;k<F;k++){const xt=k*C-D;et[x]=xt*M,et[g]=rt*E,et[m]=H,h.push(et.x,et.y,et.z),et[x]=0,et[g]=0,et[m]=b>0?1:-1,c.push(et.x,et.y,et.z),d.push(k/A),d.push(1-at/_),G+=1}}for(let at=0;at<_;at++)for(let rt=0;rt<A;rt++){const k=u+rt+F*at,xt=u+rt+F*(at+1),wt=u+(rt+1)+F*(at+1),Ct=u+(rt+1)+F*at;l.push(k,xt,Ct),l.push(xt,wt,Ct),J+=6}o.addGroup(f,J,T),f+=J,u+=G}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new es(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}let rf=class af extends Fn{constructor(t=1,e=1,i=1,n=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:i,heightSegments:n};const s=t/2,a=e/2,o=Math.floor(i),l=Math.floor(n),h=o+1,c=l+1,d=t/o,u=e/l,f=[],p=[],x=[],g=[];for(let m=0;m<c;m++){const M=m*u-a;for(let E=0;E<h;E++){const v=E*d-s;p.push(v,-M,0),x.push(0,0,1),g.push(E/o),g.push(1-m/l)}}for(let m=0;m<l;m++)for(let M=0;M<o;M++){const E=M+h*m,v=M+h*(m+1),w=M+1+h*(m+1),b=M+1+h*m;f.push(E,v,b),f.push(v,w,b)}this.setIndex(f),this.setAttribute("position",new pi(p,3)),this.setAttribute("normal",new pi(x,3)),this.setAttribute("uv",new pi(g,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new af(t.width,t.height,t.widthSegments,t.heightSegments)}},ym=class of extends Fn{constructor(t=1,e=32,i=16,n=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:i,phiStart:n,phiLength:s,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),i=Math.max(2,Math.floor(i));const l=Math.min(a+o,Math.PI);let h=0;const c=[],d=new U,u=new U,f=[],p=[],x=[],g=[];for(let m=0;m<=i;m++){const M=[],E=m/i,v=a+E*o,w=t*Math.cos(v),b=Math.sqrt(t*t-w*w);let A=0;m===0&&a===0?A=.5/e:m===i&&l===Math.PI&&(A=-.5/e);for(let _=0;_<=e;_++){const T=_/e,C=n+T*s;d.x=-b*Math.cos(C),d.y=w,d.z=b*Math.sin(C),p.push(d.x,d.y,d.z),u.copy(d).normalize(),x.push(u.x,u.y,u.z),g.push(T+A,1-E),M.push(h++)}c.push(M)}for(let m=0;m<i;m++)for(let M=0;M<e;M++){const E=c[m][M+1],v=c[m][M],w=c[m+1][M],b=c[m+1][M+1];(m!==0||a>0)&&f.push(E,v,b),(m!==i-1||l<Math.PI)&&f.push(v,w,b)}this.setIndex(f),this.setAttribute("position",new pi(p,3)),this.setAttribute("normal",new pi(x,3)),this.setAttribute("uv",new pi(g,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new of(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}};function nr(r){const t={};for(const e in r){t[e]={};for(const i in r[e]){const n=r[e][i];if(Yc(n))n.isRenderTargetTexture?(Lt("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][i]=null):t[e][i]=n.clone();else if(Array.isArray(n))if(Yc(n[0])){const s=[];for(let a=0,o=n.length;a<o;a++)s[a]=n[a].clone();t[e][i]=s}else t[e][i]=n.slice();else t[e][i]=n}}return t}function qe(r){const t={};for(let e=0;e<r.length;e++){const i=nr(r[e]);for(const n in i)t[n]=i[n]}return t}function Yc(r){return r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)}function vm(r){const t=[];for(let e=0;e<r.length;e++)t.push(r[e].clone());return t}function lf(r){const t=r.getRenderTarget();return t===null?r.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:$t.workingColorSpace}const hf={clone:nr,merge:qe};var Mm=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,bm=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;let gi=class extends ar{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Mm,this.fragmentShader=bm,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=nr(t.uniforms),this.uniformsGroups=vm(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const n in this.uniforms){const a=this.uniforms[n].value;a&&a.isTexture?e.uniforms[n]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[n]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[n]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[n]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[n]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[n]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[n]={type:"m4",value:a.toArray()}:e.uniforms[n]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const i={};for(const n in this.extensions)this.extensions[n]===!0&&(i[n]=!0);return Object.keys(i).length>0&&(e.extensions=i),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const i in t.uniforms){const n=t.uniforms[i];switch(this.uniforms[i]={},n.type){case"t":this.uniforms[i].value=e[n.value]||null;break;case"c":this.uniforms[i].value=new Ft().setHex(n.value);break;case"v2":this.uniforms[i].value=new Nt().fromArray(n.value);break;case"v3":this.uniforms[i].value=new U().fromArray(n.value);break;case"v4":this.uniforms[i].value=new _e().fromArray(n.value);break;case"m3":this.uniforms[i].value=new Ot().fromArray(n.value);break;case"m4":this.uniforms[i].value=new ue().fromArray(n.value);break;default:this.uniforms[i].value=n.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}};class Sm extends gi{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}}class Zc extends ar{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Ft(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=lo,this.normalScale=new Nt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ln,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class wm extends ar{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new Ft(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=lo,this.normalScale=new Nt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ln,this.combine=Oh,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.envMapIntensity=t.envMapIntensity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class Em extends ar{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Mp,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class Tm extends ar{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}class Am extends Pi{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Ft(t),this.intensity=e}dispose(){this.dispatchEvent({type:"dispose"})}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,e}}const el=new ue,Kc=new U,Jc=new U;class Rm{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Nt(512,512),this.mapType=ai,this.map=null,this.mapPass=null,this.matrix=new ue,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new rc,this._frameExtents=new Nt(1,1),this._viewportCount=1,this._viewports=[new _e(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,i=this.matrix;Kc.setFromMatrixPosition(t.matrixWorld),e.position.copy(Kc),Jc.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(Jc),e.updateMatrixWorld(),el.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(el,e.coordinateSystem,e.reversedDepth),e.coordinateSystem===Hr||e.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(el)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this.biasNode=t.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}const xa=new U,_a=new In,Ni=new U;let cf=class extends Pi{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ue,this.projectionMatrix=new ue,this.projectionMatrixInverse=new ue,this.coordinateSystem=Bi,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(xa,_a,Ni),Ni.x===1&&Ni.y===1&&Ni.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(xa,_a,Ni.set(1,1,1)).invert()}updateWorldMatrix(t,e,i=!1){super.updateWorldMatrix(t,e,i),this.matrixWorld.decompose(xa,_a,Ni),Ni.x===1&&Ni.y===1&&Ni.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(xa,_a,Ni.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}};const yn=new U,Qc=new Nt,jc=new Nt;class ri extends cf{constructor(t=50,e=1,i=.1,n=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=i,this.far=n,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=Wr*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(Nr*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return Wr*2*Math.atan(Math.tan(Nr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,i){yn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(yn.x,yn.y).multiplyScalar(-t/yn.z),yn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(yn.x,yn.y).multiplyScalar(-t/yn.z)}getViewSize(t,e){return this.getViewBounds(t,Qc,jc),e.subVectors(jc,Qc)}setViewOffset(t,e,i,n,s,a){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(Nr*.5*this.fov)/this.zoom,i=2*e,n=this.aspect*i,s=-.5*n;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,h=a.fullHeight;s+=a.offsetX*n/l,e-=a.offsetY*i/h,n*=a.width/l,i*=a.height/h}const o=this.filmOffset;o!==0&&(s+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+n,e,e-i,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}class Cm extends Rm{constructor(){super(new ri(90,1,.5,500)),this.isPointLightShadow=!0}}class Pm extends Am{constructor(t,e,i=0,n=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=i,this.decay=n,this.shadow=new Cm}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}toJSON(t){const e=super.toJSON(t);return e.object.distance=this.distance,e.object.decay=this.decay,e.object.shadow=this.shadow.toJSON(),e}}let ac=class extends cf{constructor(t=-1,e=1,i=1,n=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=i,this.bottom=n,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,i,n,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,n=(this.top+this.bottom)/2;let s=i-t,a=i+t,o=n+e,l=n-e;if(this.view!==null&&this.view.enabled){const h=(this.right-this.left)/this.view.fullWidth/this.zoom,c=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=h*this.view.offsetX,a=s+h*this.view.width,o-=c*this.view.offsetY,l=o-c*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}};const gs=-90,xs=1;class Dm extends Pi{constructor(t,e,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;const n=new ri(gs,xs,t,e);n.layers=this.layers,this.add(n);const s=new ri(gs,xs,t,e);s.layers=this.layers,this.add(s);const a=new ri(gs,xs,t,e);a.layers=this.layers,this.add(a);const o=new ri(gs,xs,t,e);o.layers=this.layers,this.add(o);const l=new ri(gs,xs,t,e);l.layers=this.layers,this.add(l);const h=new ri(gs,xs,t,e);h.layers=this.layers,this.add(h)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[i,n,s,a,o,l]=e;for(const h of e)this.remove(h);if(t===Bi)i.up.set(0,1,0),i.lookAt(1,0,0),n.up.set(0,1,0),n.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===Hr)i.up.set(0,-1,0),i.lookAt(-1,0,0),n.up.set(0,-1,0),n.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const h of e)this.add(h),h.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:i,activeMipmapLevel:n}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[s,a,o,l,h,c]=this.children,d=t.getRenderTarget(),u=t.getActiveCubeFace(),f=t.getActiveMipmapLevel(),p=t.xr.enabled;t.xr.enabled=!1;const x=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let g=!1;t.isWebGLRenderer===!0?g=t.state.buffers.depth.getReversed():g=t.reversedDepthBuffer,t.setRenderTarget(i,0,n),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,s),t.setRenderTarget(i,1,n),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,a),t.setRenderTarget(i,2,n),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,o),t.setRenderTarget(i,3,n),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,l),t.setRenderTarget(i,4,n),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,h),i.texture.generateMipmaps=x,t.setRenderTarget(i,5,n),g&&t.autoClear===!1&&t.clearDepth(),t.render(e,c),t.setRenderTarget(d,u,f),t.xr.enabled=p,i.texture.needsPMREMUpdate=!0}}class Im extends ri{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}}const tu=new ue;class Lm{constructor(t,e,i=0,n=1/0){this.ray=new sc(t,e),this.near=i,this.far=n,this.camera=null,this.layers=new ec,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,e.projectionMatrix.elements[14]).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):Zt("Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return tu.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(tu),this}intersectObject(t,e=!0,i=[]){return Ch(t,this,i,e),i.sort(eu),i}intersectObjects(t,e=!0,i=[]){for(let n=0,s=t.length;n<s;n++)Ch(t[n],this,i,e);return i.sort(eu),i}}function eu(r,t){return r.distance-t.distance}function Ch(r,t,e,i){let n=!0;if(r.layers.test(t.layers)&&r.raycast(t,e)===!1&&(n=!1),n===!0&&i===!0){const s=r.children;for(let a=0,o=s.length;a<o;a++)Ch(s[a],t,e,!0)}}class Nm{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1,Lt("Clock: This module has been deprecated. Please use THREE.Timer instead.")}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const e=performance.now();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}}class iu{constructor(t=1,e=0,i=0){this.radius=t,this.phi=e,this.theta=i}set(t,e,i){return this.radius=t,this.phi=e,this.theta=i,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=Wt(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,i){return this.radius=Math.sqrt(t*t+e*e+i*i),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,i),this.phi=Math.acos(Wt(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}let Mb=class uf{static{uf.prototype.isMatrix2=!0}constructor(t,e,i,n){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,i,n)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let i=0;i<4;i++)this.elements[i]=t[i+e];return this}set(t,e,i,n){const s=this.elements;return s[0]=t,s[2]=e,s[1]=i,s[3]=n,this}};class df extends Nn{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(t){if(t===void 0){Lt("Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=t}disconnect(){}dispose(){}update(){}}function nu(r,t,e,i){const n=Fm(i);switch(e){case Vd:return r*t;case $h:return r*t/n.components*n.byteLength;case Yh:return r*t/n.components*n.byteLength;case Jn:return r*t*2/n.components*n.byteLength;case Zh:return r*t*2/n.components*n.byteLength;case Gd:return r*t*3/n.components*n.byteLength;case Ei:return r*t*4/n.components*n.byteLength;case Kh:return r*t*4/n.components*n.byteLength;case Ka:case Ja:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*8;case Qa:case ja:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case Ql:case th:return Math.max(r,16)*Math.max(t,8)/4;case Jl:case jl:return Math.max(r,8)*Math.max(t,8)/2;case eh:case ih:case sh:case rh:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*8;case nh:case ao:case ah:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case oh:return Math.floor((r+3)/4)*Math.floor((t+3)/4)*16;case lh:return Math.floor((r+4)/5)*Math.floor((t+3)/4)*16;case hh:return Math.floor((r+4)/5)*Math.floor((t+4)/5)*16;case ch:return Math.floor((r+5)/6)*Math.floor((t+4)/5)*16;case uh:return Math.floor((r+5)/6)*Math.floor((t+5)/6)*16;case dh:return Math.floor((r+7)/8)*Math.floor((t+4)/5)*16;case fh:return Math.floor((r+7)/8)*Math.floor((t+5)/6)*16;case ph:return Math.floor((r+7)/8)*Math.floor((t+7)/8)*16;case mh:return Math.floor((r+9)/10)*Math.floor((t+4)/5)*16;case gh:return Math.floor((r+9)/10)*Math.floor((t+5)/6)*16;case xh:return Math.floor((r+9)/10)*Math.floor((t+7)/8)*16;case _h:return Math.floor((r+9)/10)*Math.floor((t+9)/10)*16;case yh:return Math.floor((r+11)/12)*Math.floor((t+9)/10)*16;case vh:return Math.floor((r+11)/12)*Math.floor((t+11)/12)*16;case Mh:case bh:case Sh:return Math.ceil(r/4)*Math.ceil(t/4)*16;case wh:case Eh:return Math.ceil(r/4)*Math.ceil(t/4)*8;case oo:case Th:return Math.ceil(r/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function Fm(r){switch(r){case ai:case zd:return{byteLength:1,components:1};case Vr:case Od:case ln:return{byteLength:2,components:1};case Xh:case qh:return{byteLength:2,components:4};case Hi:case Wh:case wi:return{byteLength:4,components:1};case kd:case Bd:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${r}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:zh}}));typeof window<"u"&&(window.__THREE__?Lt("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=zh);/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function ff(){let r=null,t=!1,e=null,i=null;function n(s,a){e(s,a),i=r.requestAnimationFrame(n)}return{start:function(){t!==!0&&e!==null&&r!==null&&(i=r.requestAnimationFrame(n),t=!0)},stop:function(){r!==null&&r.cancelAnimationFrame(i),t=!1},setAnimationLoop:function(s){e=s},setContext:function(s){r=s}}}function Um(r){const t=new WeakMap;function e(o,l){const h=o.array,c=o.usage,d=h.byteLength,u=r.createBuffer();r.bindBuffer(l,u),r.bufferData(l,h,c),o.onUploadCallback();let f;if(h instanceof Float32Array)f=r.FLOAT;else if(typeof Float16Array<"u"&&h instanceof Float16Array)f=r.HALF_FLOAT;else if(h instanceof Uint16Array)o.isFloat16BufferAttribute?f=r.HALF_FLOAT:f=r.UNSIGNED_SHORT;else if(h instanceof Int16Array)f=r.SHORT;else if(h instanceof Uint32Array)f=r.UNSIGNED_INT;else if(h instanceof Int32Array)f=r.INT;else if(h instanceof Int8Array)f=r.BYTE;else if(h instanceof Uint8Array)f=r.UNSIGNED_BYTE;else if(h instanceof Uint8ClampedArray)f=r.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+h);return{buffer:u,type:f,bytesPerElement:h.BYTES_PER_ELEMENT,version:o.version,size:d}}function i(o,l,h){const c=l.array,d=l.updateRanges;if(r.bindBuffer(h,o),d.length===0)r.bufferSubData(h,0,c);else{d.sort((f,p)=>f.start-p.start);let u=0;for(let f=1;f<d.length;f++){const p=d[u],x=d[f];x.start<=p.start+p.count+1?p.count=Math.max(p.count,x.start+x.count-p.start):(++u,d[u]=x)}d.length=u+1;for(let f=0,p=d.length;f<p;f++){const x=d[f];r.bufferSubData(h,x.start*c.BYTES_PER_ELEMENT,c,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function n(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=t.get(o);l&&(r.deleteBuffer(l.buffer),t.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const c=t.get(o);(!c||c.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const h=t.get(o);if(h===void 0)t.set(o,e(o,l));else if(h.version<o.version){if(h.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(h.buffer,o,l),h.version=o.version}}return{get:n,remove:s,update:a}}var zm=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Om=`#ifdef USE_ALPHAHASH
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
#endif`,km=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Bm=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Vm=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Gm=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Hm=`#ifdef USE_AOMAP
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
#endif`,Wm=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Xm=`#ifdef USE_BATCHING
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
#endif`,qm=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,$m=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Ym=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Zm=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Km=`#ifdef USE_IRIDESCENCE
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
#endif`,Jm=`#ifdef USE_BUMPMAP
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
#endif`,Qm=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,jm=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,t0=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,e0=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,i0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,n0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,s0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,r0=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,a0=`#define PI 3.141592653589793
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
} // validated`,o0=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,l0=`vec3 transformedNormal = objectNormal;
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
#endif`,h0=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,c0=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,u0=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,d0=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,f0="gl_FragColor = linearToOutputTexel( gl_FragColor );",p0=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,m0=`#ifdef USE_ENVMAP
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
#endif`,g0=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,x0=`#ifdef USE_ENVMAP
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
#endif`,_0=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,y0=`#ifdef USE_ENVMAP
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
#endif`,v0=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,M0=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,b0=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,S0=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,w0=`#ifdef USE_GRADIENTMAP
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
}`,E0=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,T0=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,A0=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,R0=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,C0=`#ifdef USE_ENVMAP
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
#endif`,P0=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,D0=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,I0=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,L0=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,N0=`PhysicalMaterial material;
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
#endif`,F0=`uniform sampler2D dfgLUT;
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
}`,U0=`
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
#endif`,z0=`#if defined( RE_IndirectDiffuse )
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
#endif`,O0=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,k0=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,B0=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,V0=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,G0=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,H0=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,W0=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,X0=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,q0=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,$0=`#if defined( USE_POINTS_UV )
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
#endif`,Y0=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Z0=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,K0=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,J0=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Q0=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,j0=`#ifdef USE_MORPHTARGETS
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
#endif`,tg=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,eg=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,ig=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,ng=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,sg=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,rg=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,ag=`#ifdef USE_NORMALMAP
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
#endif`,og=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,lg=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,hg=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,cg=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,ug=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,dg=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,fg=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,pg=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,mg=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,gg=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,xg=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,_g=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,yg=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,vg=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Mg=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,bg=`float getShadowMask() {
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
}`,Sg=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,wg=`#ifdef USE_SKINNING
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
#endif`,Eg=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Tg=`#ifdef USE_SKINNING
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
#endif`,Ag=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Rg=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Cg=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Pg=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Dg=`#ifdef USE_TRANSMISSION
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
#endif`,Ig=`#ifdef USE_TRANSMISSION
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
#endif`,Lg=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ng=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Fg=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ug=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const zg=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Og=`uniform sampler2D t2D;
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
}`,kg=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Bg=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Vg=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Gg=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Hg=`#include <common>
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
}`,Wg=`#if DEPTH_PACKING == 3200
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
}`,Xg=`#define DISTANCE
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
}`,qg=`#define DISTANCE
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
}`,$g=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Yg=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Zg=`uniform float scale;
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
}`,Kg=`uniform vec3 diffuse;
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
}`,Jg=`#include <common>
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
}`,Qg=`uniform vec3 diffuse;
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
}`,jg=`#define LAMBERT
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
}`,tx=`#define LAMBERT
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
}`,ex=`#define MATCAP
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
}`,ix=`#define MATCAP
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
}`,nx=`#define NORMAL
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
}`,sx=`#define NORMAL
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
}`,rx=`#define PHONG
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
}`,ax=`#define PHONG
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
}`,ox=`#define STANDARD
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
}`,lx=`#define STANDARD
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
}`,hx=`#define TOON
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
}`,cx=`#define TOON
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
}`,ux=`uniform float size;
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
}`,dx=`uniform vec3 diffuse;
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
}`,fx=`#include <common>
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
}`,px=`uniform vec3 color;
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
}`,mx=`uniform float rotation;
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
}`,gx=`uniform vec3 diffuse;
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
}`,Vt={alphahash_fragment:zm,alphahash_pars_fragment:Om,alphamap_fragment:km,alphamap_pars_fragment:Bm,alphatest_fragment:Vm,alphatest_pars_fragment:Gm,aomap_fragment:Hm,aomap_pars_fragment:Wm,batching_pars_vertex:Xm,batching_vertex:qm,begin_vertex:$m,beginnormal_vertex:Ym,bsdfs:Zm,iridescence_fragment:Km,bumpmap_pars_fragment:Jm,clipping_planes_fragment:Qm,clipping_planes_pars_fragment:jm,clipping_planes_pars_vertex:t0,clipping_planes_vertex:e0,color_fragment:i0,color_pars_fragment:n0,color_pars_vertex:s0,color_vertex:r0,common:a0,cube_uv_reflection_fragment:o0,defaultnormal_vertex:l0,displacementmap_pars_vertex:h0,displacementmap_vertex:c0,emissivemap_fragment:u0,emissivemap_pars_fragment:d0,colorspace_fragment:f0,colorspace_pars_fragment:p0,envmap_fragment:m0,envmap_common_pars_fragment:g0,envmap_pars_fragment:x0,envmap_pars_vertex:_0,envmap_physical_pars_fragment:C0,envmap_vertex:y0,fog_vertex:v0,fog_pars_vertex:M0,fog_fragment:b0,fog_pars_fragment:S0,gradientmap_pars_fragment:w0,lightmap_pars_fragment:E0,lights_lambert_fragment:T0,lights_lambert_pars_fragment:A0,lights_pars_begin:R0,lights_toon_fragment:P0,lights_toon_pars_fragment:D0,lights_phong_fragment:I0,lights_phong_pars_fragment:L0,lights_physical_fragment:N0,lights_physical_pars_fragment:F0,lights_fragment_begin:U0,lights_fragment_maps:z0,lights_fragment_end:O0,lightprobes_pars_fragment:k0,logdepthbuf_fragment:B0,logdepthbuf_pars_fragment:V0,logdepthbuf_pars_vertex:G0,logdepthbuf_vertex:H0,map_fragment:W0,map_pars_fragment:X0,map_particle_fragment:q0,map_particle_pars_fragment:$0,metalnessmap_fragment:Y0,metalnessmap_pars_fragment:Z0,morphinstance_vertex:K0,morphcolor_vertex:J0,morphnormal_vertex:Q0,morphtarget_pars_vertex:j0,morphtarget_vertex:tg,normal_fragment_begin:eg,normal_fragment_maps:ig,normal_pars_fragment:ng,normal_pars_vertex:sg,normal_vertex:rg,normalmap_pars_fragment:ag,clearcoat_normal_fragment_begin:og,clearcoat_normal_fragment_maps:lg,clearcoat_pars_fragment:hg,iridescence_pars_fragment:cg,opaque_fragment:ug,packing:dg,premultiplied_alpha_fragment:fg,project_vertex:pg,dithering_fragment:mg,dithering_pars_fragment:gg,roughnessmap_fragment:xg,roughnessmap_pars_fragment:_g,shadowmap_pars_fragment:yg,shadowmap_pars_vertex:vg,shadowmap_vertex:Mg,shadowmask_pars_fragment:bg,skinbase_vertex:Sg,skinning_pars_vertex:wg,skinning_vertex:Eg,skinnormal_vertex:Tg,specularmap_fragment:Ag,specularmap_pars_fragment:Rg,tonemapping_fragment:Cg,tonemapping_pars_fragment:Pg,transmission_fragment:Dg,transmission_pars_fragment:Ig,uv_pars_fragment:Lg,uv_pars_vertex:Ng,uv_vertex:Fg,worldpos_vertex:Ug,background_vert:zg,background_frag:Og,backgroundCube_vert:kg,backgroundCube_frag:Bg,cube_vert:Vg,cube_frag:Gg,depth_vert:Hg,depth_frag:Wg,distance_vert:Xg,distance_frag:qg,equirect_vert:$g,equirect_frag:Yg,linedashed_vert:Zg,linedashed_frag:Kg,meshbasic_vert:Jg,meshbasic_frag:Qg,meshlambert_vert:jg,meshlambert_frag:tx,meshmatcap_vert:ex,meshmatcap_frag:ix,meshnormal_vert:nx,meshnormal_frag:sx,meshphong_vert:rx,meshphong_frag:ax,meshphysical_vert:ox,meshphysical_frag:lx,meshtoon_vert:hx,meshtoon_frag:cx,points_vert:ux,points_frag:dx,shadow_vert:fx,shadow_frag:px,sprite_vert:mx,sprite_frag:gx},ft={common:{diffuse:{value:new Ft(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ot},alphaMap:{value:null},alphaMapTransform:{value:new Ot},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ot}},envmap:{envMap:{value:null},envMapRotation:{value:new Ot},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ot}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ot}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ot},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ot},normalScale:{value:new Nt(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ot},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ot}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ot}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ot}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ft(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new U},probesMax:{value:new U},probesResolution:{value:new U}},points:{diffuse:{value:new Ft(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ot},alphaTest:{value:0},uvTransform:{value:new Ot}},sprite:{diffuse:{value:new Ft(16777215)},opacity:{value:1},center:{value:new Nt(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ot},alphaMap:{value:null},alphaMapTransform:{value:new Ot},alphaTest:{value:0}}},Oi={basic:{uniforms:qe([ft.common,ft.specularmap,ft.envmap,ft.aomap,ft.lightmap,ft.fog]),vertexShader:Vt.meshbasic_vert,fragmentShader:Vt.meshbasic_frag},lambert:{uniforms:qe([ft.common,ft.specularmap,ft.envmap,ft.aomap,ft.lightmap,ft.emissivemap,ft.bumpmap,ft.normalmap,ft.displacementmap,ft.fog,ft.lights,{emissive:{value:new Ft(0)},envMapIntensity:{value:1}}]),vertexShader:Vt.meshlambert_vert,fragmentShader:Vt.meshlambert_frag},phong:{uniforms:qe([ft.common,ft.specularmap,ft.envmap,ft.aomap,ft.lightmap,ft.emissivemap,ft.bumpmap,ft.normalmap,ft.displacementmap,ft.fog,ft.lights,{emissive:{value:new Ft(0)},specular:{value:new Ft(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Vt.meshphong_vert,fragmentShader:Vt.meshphong_frag},standard:{uniforms:qe([ft.common,ft.envmap,ft.aomap,ft.lightmap,ft.emissivemap,ft.bumpmap,ft.normalmap,ft.displacementmap,ft.roughnessmap,ft.metalnessmap,ft.fog,ft.lights,{emissive:{value:new Ft(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Vt.meshphysical_vert,fragmentShader:Vt.meshphysical_frag},toon:{uniforms:qe([ft.common,ft.aomap,ft.lightmap,ft.emissivemap,ft.bumpmap,ft.normalmap,ft.displacementmap,ft.gradientmap,ft.fog,ft.lights,{emissive:{value:new Ft(0)}}]),vertexShader:Vt.meshtoon_vert,fragmentShader:Vt.meshtoon_frag},matcap:{uniforms:qe([ft.common,ft.bumpmap,ft.normalmap,ft.displacementmap,ft.fog,{matcap:{value:null}}]),vertexShader:Vt.meshmatcap_vert,fragmentShader:Vt.meshmatcap_frag},points:{uniforms:qe([ft.points,ft.fog]),vertexShader:Vt.points_vert,fragmentShader:Vt.points_frag},dashed:{uniforms:qe([ft.common,ft.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Vt.linedashed_vert,fragmentShader:Vt.linedashed_frag},depth:{uniforms:qe([ft.common,ft.displacementmap]),vertexShader:Vt.depth_vert,fragmentShader:Vt.depth_frag},normal:{uniforms:qe([ft.common,ft.bumpmap,ft.normalmap,ft.displacementmap,{opacity:{value:1}}]),vertexShader:Vt.meshnormal_vert,fragmentShader:Vt.meshnormal_frag},sprite:{uniforms:qe([ft.sprite,ft.fog]),vertexShader:Vt.sprite_vert,fragmentShader:Vt.sprite_frag},background:{uniforms:{uvTransform:{value:new Ot},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Vt.background_vert,fragmentShader:Vt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ot}},vertexShader:Vt.backgroundCube_vert,fragmentShader:Vt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Vt.cube_vert,fragmentShader:Vt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Vt.equirect_vert,fragmentShader:Vt.equirect_frag},distance:{uniforms:qe([ft.common,ft.displacementmap,{referencePosition:{value:new U},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Vt.distance_vert,fragmentShader:Vt.distance_frag},shadow:{uniforms:qe([ft.lights,ft.fog,{color:{value:new Ft(0)},opacity:{value:1}}]),vertexShader:Vt.shadow_vert,fragmentShader:Vt.shadow_frag}};Oi.physical={uniforms:qe([Oi.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ot},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ot},clearcoatNormalScale:{value:new Nt(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ot},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ot},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ot},sheen:{value:0},sheenColor:{value:new Ft(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ot},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ot},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ot},transmissionSamplerSize:{value:new Nt},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ot},attenuationDistance:{value:0},attenuationColor:{value:new Ft(0)},specularColor:{value:new Ft(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ot},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ot},anisotropyVector:{value:new Nt},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ot}}]),vertexShader:Vt.meshphysical_vert,fragmentShader:Vt.meshphysical_frag};const ya={r:0,b:0,g:0},xx=new ue,pf=new Ot;pf.set(-1,0,0,0,1,0,0,0,1);function _x(r,t,e,i,n,s){const a=new Ft(0);let o=n===!0?0:1,l,h,c=null,d=0,u=null;function f(M){let E=M.isScene===!0?M.background:null;if(E&&E.isTexture){const v=M.backgroundBlurriness>0;E=t.get(E,v)}return E}function p(M){let E=!1;const v=f(M);v===null?g(a,o):v&&v.isColor&&(g(v,1),E=!0);const w=r.xr.getEnvironmentBlendMode();w==="additive"?e.buffers.color.setClear(0,0,0,1,s):w==="alpha-blend"&&e.buffers.color.setClear(0,0,0,0,s),(r.autoClear||E)&&(e.buffers.depth.setTest(!0),e.buffers.depth.setMask(!0),e.buffers.color.setMask(!0),r.clear(r.autoClearColor,r.autoClearDepth,r.autoClearStencil))}function x(M,E){const v=f(E);v&&(v.isCubeTexture||v.mapping===bo)?(h===void 0&&(h=new Se(new es(1,1,1),new gi({name:"BackgroundCubeMaterial",uniforms:nr(Oi.backgroundCube.uniforms),vertexShader:Oi.backgroundCube.vertexShader,fragmentShader:Oi.backgroundCube.fragmentShader,side:Ue,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(w,b,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),h.material.uniforms.envMap.value=v,h.material.uniforms.backgroundBlurriness.value=E.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(xx.makeRotationFromEuler(E.backgroundRotation)).transpose(),v.isCubeTexture&&v.isRenderTargetTexture===!1&&h.material.uniforms.backgroundRotation.value.premultiply(pf),h.material.toneMapped=$t.getTransfer(v.colorSpace)!==te,(c!==v||d!==v.version||u!==r.toneMapping)&&(h.material.needsUpdate=!0,c=v,d=v.version,u=r.toneMapping),h.layers.enableAll(),M.unshift(h,h.geometry,h.material,0,0,null)):v&&v.isTexture&&(l===void 0&&(l=new Se(new rf(2,2),new gi({name:"BackgroundMaterial",uniforms:nr(Oi.background.uniforms),vertexShader:Oi.background.vertexShader,fragmentShader:Oi.background.fragmentShader,side:Dn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=v,l.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,l.material.toneMapped=$t.getTransfer(v.colorSpace)!==te,v.matrixAutoUpdate===!0&&v.updateMatrix(),l.material.uniforms.uvTransform.value.copy(v.matrix),(c!==v||d!==v.version||u!==r.toneMapping)&&(l.material.needsUpdate=!0,c=v,d=v.version,u=r.toneMapping),l.layers.enableAll(),M.unshift(l,l.geometry,l.material,0,0,null))}function g(M,E){M.getRGB(ya,lf(r)),e.buffers.color.setClear(ya.r,ya.g,ya.b,E,s)}function m(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(M,E=1){a.set(M),o=E,g(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(M){o=M,g(a,o)},render:p,addToRenderList:x,dispose:m}}function yx(r,t){const e=r.getParameter(r.MAX_VERTEX_ATTRIBS),i={},n=u(null);let s=n,a=!1;function o(P,D,O,H,F){let q=!1;const G=d(P,H,O,D);s!==G&&(s=G,h(s.object)),q=f(P,H,O,F),q&&p(P,H,O,F),F!==null&&t.update(F,r.ELEMENT_ARRAY_BUFFER),(q||a)&&(a=!1,v(P,D,O,H),F!==null&&r.bindBuffer(r.ELEMENT_ARRAY_BUFFER,t.get(F).buffer))}function l(){return r.createVertexArray()}function h(P){return r.bindVertexArray(P)}function c(P){return r.deleteVertexArray(P)}function d(P,D,O,H){const F=H.wireframe===!0;let q=i[D.id];q===void 0&&(q={},i[D.id]=q);const G=P.isInstancedMesh===!0?P.id:0;let J=q[G];J===void 0&&(J={},q[G]=J);let et=J[O.id];et===void 0&&(et={},J[O.id]=et);let at=et[F];return at===void 0&&(at=u(l()),et[F]=at),at}function u(P){const D=[],O=[],H=[];for(let F=0;F<e;F++)D[F]=0,O[F]=0,H[F]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:D,enabledAttributes:O,attributeDivisors:H,object:P,attributes:{},index:null}}function f(P,D,O,H){const F=s.attributes,q=D.attributes;let G=0;const J=O.getAttributes();for(const et in J)if(J[et].location>=0){const rt=F[et];let k=q[et];if(k===void 0&&(et==="instanceMatrix"&&P.instanceMatrix&&(k=P.instanceMatrix),et==="instanceColor"&&P.instanceColor&&(k=P.instanceColor)),rt===void 0||rt.attribute!==k||k&&rt.data!==k.data)return!0;G++}return s.attributesNum!==G||s.index!==H}function p(P,D,O,H){const F={},q=D.attributes;let G=0;const J=O.getAttributes();for(const et in J)if(J[et].location>=0){let rt=q[et];rt===void 0&&(et==="instanceMatrix"&&P.instanceMatrix&&(rt=P.instanceMatrix),et==="instanceColor"&&P.instanceColor&&(rt=P.instanceColor));const k={};k.attribute=rt,rt&&rt.data&&(k.data=rt.data),F[et]=k,G++}s.attributes=F,s.attributesNum=G,s.index=H}function x(){const P=s.newAttributes;for(let D=0,O=P.length;D<O;D++)P[D]=0}function g(P){m(P,0)}function m(P,D){const O=s.newAttributes,H=s.enabledAttributes,F=s.attributeDivisors;O[P]=1,H[P]===0&&(r.enableVertexAttribArray(P),H[P]=1),F[P]!==D&&(r.vertexAttribDivisor(P,D),F[P]=D)}function M(){const P=s.newAttributes,D=s.enabledAttributes;for(let O=0,H=D.length;O<H;O++)D[O]!==P[O]&&(r.disableVertexAttribArray(O),D[O]=0)}function E(P,D,O,H,F,q,G){G===!0?r.vertexAttribIPointer(P,D,O,F,q):r.vertexAttribPointer(P,D,O,H,F,q)}function v(P,D,O,H){x();const F=H.attributes,q=O.getAttributes(),G=D.defaultAttributeValues;for(const J in q){const et=q[J];if(et.location>=0){let at=F[J];if(at===void 0&&(J==="instanceMatrix"&&P.instanceMatrix&&(at=P.instanceMatrix),J==="instanceColor"&&P.instanceColor&&(at=P.instanceColor)),at!==void 0){const rt=at.normalized,k=at.itemSize,xt=t.get(at);if(xt===void 0)continue;const wt=xt.buffer,Ct=xt.type,Y=xt.bytesPerElement,nt=Ct===r.INT||Ct===r.UNSIGNED_INT||at.gpuType===Wh;if(at.isInterleavedBufferAttribute){const it=at.data,Dt=it.stride,bt=at.offset;if(it.isInstancedInterleavedBuffer){for(let At=0;At<et.locationSize;At++)m(et.location+At,it.meshPerAttribute);P.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=it.meshPerAttribute*it.count)}else for(let At=0;At<et.locationSize;At++)g(et.location+At);r.bindBuffer(r.ARRAY_BUFFER,wt);for(let At=0;At<et.locationSize;At++)E(et.location+At,k/et.locationSize,Ct,rt,Dt*Y,(bt+k/et.locationSize*At)*Y,nt)}else{if(at.isInstancedBufferAttribute){for(let it=0;it<et.locationSize;it++)m(et.location+it,at.meshPerAttribute);P.isInstancedMesh!==!0&&H._maxInstanceCount===void 0&&(H._maxInstanceCount=at.meshPerAttribute*at.count)}else for(let it=0;it<et.locationSize;it++)g(et.location+it);r.bindBuffer(r.ARRAY_BUFFER,wt);for(let it=0;it<et.locationSize;it++)E(et.location+it,k/et.locationSize,Ct,rt,k*Y,k/et.locationSize*it*Y,nt)}}else if(G!==void 0){const rt=G[J];if(rt!==void 0)switch(rt.length){case 2:r.vertexAttrib2fv(et.location,rt);break;case 3:r.vertexAttrib3fv(et.location,rt);break;case 4:r.vertexAttrib4fv(et.location,rt);break;default:r.vertexAttrib1fv(et.location,rt)}}}}M()}function w(){T();for(const P in i){const D=i[P];for(const O in D){const H=D[O];for(const F in H){const q=H[F];for(const G in q)c(q[G].object),delete q[G];delete H[F]}}delete i[P]}}function b(P){if(i[P.id]===void 0)return;const D=i[P.id];for(const O in D){const H=D[O];for(const F in H){const q=H[F];for(const G in q)c(q[G].object),delete q[G];delete H[F]}}delete i[P.id]}function A(P){for(const D in i){const O=i[D];for(const H in O){const F=O[H];if(F[P.id]===void 0)continue;const q=F[P.id];for(const G in q)c(q[G].object),delete q[G];delete F[P.id]}}}function _(P){for(const D in i){const O=i[D],H=P.isInstancedMesh===!0?P.id:0,F=O[H];if(F!==void 0){for(const q in F){const G=F[q];for(const J in G)c(G[J].object),delete G[J];delete F[q]}delete O[H],Object.keys(O).length===0&&delete i[D]}}}function T(){C(),a=!0,s!==n&&(s=n,h(s.object))}function C(){n.geometry=null,n.program=null,n.wireframe=!1}return{setup:o,reset:T,resetDefaultState:C,dispose:w,releaseStatesOfGeometry:b,releaseStatesOfObject:_,releaseStatesOfProgram:A,initAttributes:x,enableAttribute:g,disableUnusedAttributes:M}}function vx(r,t,e){let i;function n(l){i=l}function s(l,h){r.drawArrays(i,l,h),e.update(h,i,1)}function a(l,h,c){c!==0&&(r.drawArraysInstanced(i,l,h,c),e.update(h,i,c))}function o(l,h,c){if(c===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,h,0,c);let u=0;for(let f=0;f<c;f++)u+=h[f];e.update(u,i,1)}this.setMode=n,this.render=s,this.renderInstances=a,this.renderMultiDraw=o}function Mx(r,t,e,i){let n;function s(){if(n!==void 0)return n;if(t.has("EXT_texture_filter_anisotropic")===!0){const A=t.get("EXT_texture_filter_anisotropic");n=r.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function a(A){return!(A!==Ei&&i.convert(A)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(A){const _=A===ln&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(A!==ai&&i.convert(A)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==wi&&!_)}function l(A){if(A==="highp"){if(r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.HIGH_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.MEDIUM_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let h=e.precision!==void 0?e.precision:"highp";const c=l(h);c!==h&&(Lt("WebGLRenderer:",h,"not supported, using",c,"instead."),h=c);const d=e.logarithmicDepthBuffer===!0,u=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control");e.reversedDepthBuffer===!0&&u===!1&&Lt("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");const f=r.getParameter(r.MAX_TEXTURE_IMAGE_UNITS),p=r.getParameter(r.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=r.getParameter(r.MAX_TEXTURE_SIZE),g=r.getParameter(r.MAX_CUBE_MAP_TEXTURE_SIZE),m=r.getParameter(r.MAX_VERTEX_ATTRIBS),M=r.getParameter(r.MAX_VERTEX_UNIFORM_VECTORS),E=r.getParameter(r.MAX_VARYING_VECTORS),v=r.getParameter(r.MAX_FRAGMENT_UNIFORM_VECTORS),w=r.getParameter(r.MAX_SAMPLES),b=r.getParameter(r.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:h,logarithmicDepthBuffer:d,reversedDepthBuffer:u,maxTextures:f,maxVertexTextures:p,maxTextureSize:x,maxCubemapSize:g,maxAttributes:m,maxVertexUniforms:M,maxVaryings:E,maxFragmentUniforms:v,maxSamples:w,samples:b}}function bx(r){const t=this;let e=null,i=0,n=!1,s=!1;const a=new En,o=new Ot,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,u){const f=d.length!==0||u||i!==0||n;return n=u,i=d.length,f},this.beginShadows=function(){s=!0,c(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(d,u){e=c(d,u,0)},this.setState=function(d,u,f){const p=d.clippingPlanes,x=d.clipIntersection,g=d.clipShadows,m=r.get(d);if(!n||p===null||p.length===0||s&&!g)s?c(null):h();else{const M=s?0:i,E=M*4;let v=m.clippingState||null;l.value=v,v=c(p,u,E,f);for(let w=0;w!==E;++w)v[w]=e[w];m.clippingState=v,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=M}};function h(){l.value!==e&&(l.value=e,l.needsUpdate=i>0),t.numPlanes=i,t.numIntersection=0}function c(d,u,f,p){const x=d!==null?d.length:0;let g=null;if(x!==0){if(g=l.value,p!==!0||g===null){const m=f+x*4,M=u.matrixWorldInverse;o.getNormalMatrix(M),(g===null||g.length<m)&&(g=new Float32Array(m));for(let E=0,v=f;E!==x;++E,v+=4)a.copy(d[E]).applyMatrix4(M,o),a.normal.toArray(g,v),g[v+3]=a.constant}l.value=g,l.needsUpdate=!0}return t.numPlanes=x,t.numIntersection=0,g}}const Cn=4,su=[.125,.215,.35,.446,.526,.582],$n=20,Sx=256,xr=new ac,ru=new Ft;let il=null,nl=0,sl=0,rl=!1;const wx=new U;class Ph{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,e=0,i=.1,n=100,s={}){const{size:a=256,position:o=wx}=s;il=this._renderer.getRenderTarget(),nl=this._renderer.getActiveCubeFace(),sl=this._renderer.getActiveMipmapLevel(),rl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);const l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,i,n,l,o),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=lu(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=ou(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(il,nl,sl),this._renderer.xr.enabled=rl,t.scissorTest=!1,_s(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Kn||t.mapping===er?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),il=this._renderer.getRenderTarget(),nl=this._renderer.getActiveCubeFace(),sl=this._renderer.getActiveMipmapLevel(),rl=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const i=e||this._allocateTargets();return this._textureToCubeUV(t,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,i={magFilter:He,minFilter:He,generateMipmaps:!1,type:ln,format:Ei,colorSpace:ho,depthBuffer:!1},n=au(t,e,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=au(t,e,i);const{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=Ex(s)),this._blurMaterial=Ax(s,t,e),this._ggxMaterial=Tx(s,t,e)}return n}_compileMaterial(t){const e=new Se(new Fn,t);this._renderer.compile(e,xr)}_sceneToCubeUV(t,e,i,n,s){const l=new ri(90,1,e,i),h=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],d=this._renderer,u=d.autoClear,f=d.toneMapping;d.getClearColor(ru),d.toneMapping=Ti,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(n),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Se(new es,new tf({name:"PMREM.Background",side:Ue,depthWrite:!1,depthTest:!1})));const x=this._backgroundBox,g=x.material;let m=!1;const M=t.background;M?M.isColor&&(g.color.copy(M),t.background=null,m=!0):(g.color.copy(ru),m=!0);for(let E=0;E<6;E++){const v=E%3;v===0?(l.up.set(0,h[E],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+c[E],s.y,s.z)):v===1?(l.up.set(0,0,h[E]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+c[E],s.z)):(l.up.set(0,h[E],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+c[E]));const w=this._cubeSize;_s(n,v*w,E>2?w:0,w,w),d.setRenderTarget(n),m&&d.render(x,l),d.render(t,l)}d.toneMapping=f,d.autoClear=u,t.background=M}_textureToCubeUV(t,e){const i=this._renderer,n=t.mapping===Kn||t.mapping===er;n?(this._cubemapMaterial===null&&(this._cubemapMaterial=lu()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=ou());const s=n?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=s;const o=s.uniforms;o.envMap.value=t;const l=this._cubeSize;_s(e,0,0,3*l,2*l),i.setRenderTarget(e),i.render(a,xr)}_applyPMREM(t){const e=this._renderer,i=e.autoClear;e.autoClear=!1;const n=this._lodMeshes.length;for(let s=1;s<n;s++)this._applyGGXFilter(t,s-1,s);e.autoClear=i}_applyGGXFilter(t,e,i){const n=this._renderer,s=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[i];o.material=a;const l=a.uniforms,h=i/(this._lodMeshes.length-1),c=e/(this._lodMeshes.length-1),d=Math.sqrt(h*h-c*c),u=0+h*1.25,f=d*u,{_lodMax:p}=this,x=this._sizeLods[i],g=3*x*(i>p-Cn?i-p+Cn:0),m=4*(this._cubeSize-x);l.envMap.value=t.texture,l.roughness.value=f,l.mipInt.value=p-e,_s(s,g,m,3*x,2*x),n.setRenderTarget(s),n.render(o,xr),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=p-i,_s(t,g,m,3*x,2*x),n.setRenderTarget(t),n.render(o,xr)}_blur(t,e,i,n,s){const a=this._pingPongRenderTarget;this._halfBlur(t,a,e,i,n,"latitudinal",s),this._halfBlur(a,t,i,i,n,"longitudinal",s)}_halfBlur(t,e,i,n,s,a,o){const l=this._renderer,h=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&Zt("blur direction must be either latitudinal or longitudinal!");const c=3,d=this._lodMeshes[n];d.material=h;const u=h.uniforms,f=this._sizeLods[i]-1,p=isFinite(s)?Math.PI/(2*f):2*Math.PI/(2*$n-1),x=s/p,g=isFinite(s)?1+Math.floor(c*x):$n;g>$n&&Lt(`sigmaRadians, ${s}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${$n}`);const m=[];let M=0;for(let A=0;A<$n;++A){const _=A/x,T=Math.exp(-_*_/2);m.push(T),A===0?M+=T:A<g&&(M+=2*T)}for(let A=0;A<m.length;A++)m[A]=m[A]/M;u.envMap.value=t.texture,u.samples.value=g,u.weights.value=m,u.latitudinal.value=a==="latitudinal",o&&(u.poleAxis.value=o);const{_lodMax:E}=this;u.dTheta.value=p,u.mipInt.value=E-i;const v=this._sizeLods[n],w=3*v*(n>E-Cn?n-E+Cn:0),b=4*(this._cubeSize-v);_s(e,w,b,3*v,2*v),l.setRenderTarget(e),l.render(d,xr)}}function Ex(r){const t=[],e=[],i=[];let n=r;const s=r-Cn+1+su.length;for(let a=0;a<s;a++){const o=Math.pow(2,n);t.push(o);let l=1/o;a>r-Cn?l=su[a-r+Cn-1]:a===0&&(l=0),e.push(l);const h=1/(o-2),c=-h,d=1+h,u=[c,c,d,c,d,d,c,c,d,d,c,d],f=6,p=6,x=3,g=2,m=1,M=new Float32Array(x*p*f),E=new Float32Array(g*p*f),v=new Float32Array(m*p*f);for(let b=0;b<f;b++){const A=b%3*2/3-1,_=b>2?0:-1,T=[A,_,0,A+2/3,_,0,A+2/3,_+1,0,A,_,0,A+2/3,_+1,0,A,_+1,0];M.set(T,x*p*b),E.set(u,g*p*b);const C=[b,b,b,b,b,b];v.set(C,m*p*b)}const w=new Fn;w.setAttribute("position",new Ai(M,x)),w.setAttribute("uv",new Ai(E,g)),w.setAttribute("faceIndex",new Ai(v,m)),i.push(new Se(w,null)),n>Cn&&n--}return{lodMeshes:i,sizeLods:t,sigmas:e}}function au(r,t,e){const i=new Gi(r,t,e);return i.texture.mapping=bo,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function _s(r,t,e,i,n){r.viewport.set(t,e,i,n),r.scissor.set(t,e,i,n)}function Tx(r,t,e){return new gi({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:Sx,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:So(),fragmentShader:`

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
		`,blending:sn,depthTest:!1,depthWrite:!1})}function Ax(r,t,e){const i=new Float32Array($n),n=new U(0,1,0);return new gi({name:"SphericalGaussianBlur",defines:{n:$n,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:n}},vertexShader:So(),fragmentShader:`

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
		`,blending:sn,depthTest:!1,depthWrite:!1})}function ou(){return new gi({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:So(),fragmentShader:`

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
		`,blending:sn,depthTest:!1,depthWrite:!1})}function lu(){return new gi({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:So(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:sn,depthTest:!1,depthWrite:!1})}function So(){return`

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
	`}class mf extends Gi{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const i={width:t,height:t,depth:1},n=[i,i,i,i,i,i];this.texture=new nf(n),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},n=new es(5,5,5),s=new gi({name:"CubemapFromEquirect",uniforms:nr(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Ue,blending:sn});s.uniforms.tEquirect.value=e;const a=new Se(n,s),o=e.minFilter;return e.minFilter===Yn&&(e.minFilter=He),new Dm(1,10,this).update(t,a),e.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(t,e=!0,i=!0,n=!0){const s=t.getRenderTarget();for(let a=0;a<6;a++)t.setRenderTarget(this,a),t.clear(e,i,n);t.setRenderTarget(s)}}function Rx(r){let t=new WeakMap,e=new WeakMap,i=null;function n(u,f=!1){return u==null?null:f?a(u):s(u)}function s(u){if(u&&u.isTexture){const f=u.mapping;if(f===Lr||f===Do)if(t.has(u)){const p=t.get(u).texture;return o(p,u.mapping)}else{const p=u.image;if(p&&p.height>0){const x=new mf(p.height);return x.fromEquirectangularTexture(r,u),t.set(u,x),u.addEventListener("dispose",h),o(x.texture,u.mapping)}else return null}}return u}function a(u){if(u&&u.isTexture){const f=u.mapping,p=f===Lr||f===Do,x=f===Kn||f===er;if(p||x){let g=e.get(u);const m=g!==void 0?g.texture.pmremVersion:0;if(u.isRenderTargetTexture&&u.pmremVersion!==m)return i===null&&(i=new Ph(r)),g=p?i.fromEquirectangular(u,g):i.fromCubemap(u,g),g.texture.pmremVersion=u.pmremVersion,e.set(u,g),g.texture;if(g!==void 0)return g.texture;{const M=u.image;return p&&M&&M.height>0||x&&M&&l(M)?(i===null&&(i=new Ph(r)),g=p?i.fromEquirectangular(u):i.fromCubemap(u),g.texture.pmremVersion=u.pmremVersion,e.set(u,g),u.addEventListener("dispose",c),g.texture):null}}}return u}function o(u,f){return f===Lr?u.mapping=Kn:f===Do&&(u.mapping=er),u}function l(u){let f=0;const p=6;for(let x=0;x<p;x++)u[x]!==void 0&&f++;return f===p}function h(u){const f=u.target;f.removeEventListener("dispose",h);const p=t.get(f);p!==void 0&&(t.delete(f),p.dispose())}function c(u){const f=u.target;f.removeEventListener("dispose",c);const p=e.get(f);p!==void 0&&(e.delete(f),p.dispose())}function d(){t=new WeakMap,e=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:n,dispose:d}}function Cx(r){const t={};function e(i){if(t[i]!==void 0)return t[i];const n=r.getExtension(i);return t[i]=n,n}return{has:function(i){return e(i)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(i){const n=e(i);return n===null&&Ys("WebGLRenderer: "+i+" extension not supported."),n}}}function Px(r,t,e,i){const n={},s=new WeakMap;function a(d){const u=d.target;u.index!==null&&t.remove(u.index);for(const p in u.attributes)t.remove(u.attributes[p]);u.removeEventListener("dispose",a),delete n[u.id];const f=s.get(u);f&&(t.remove(f),s.delete(u)),i.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,e.memory.geometries--}function o(d,u){return n[u.id]===!0||(u.addEventListener("dispose",a),n[u.id]=!0,e.memory.geometries++),u}function l(d){const u=d.attributes;for(const f in u)t.update(u[f],r.ARRAY_BUFFER)}function h(d){const u=[],f=d.index,p=d.attributes.position;let x=0;if(p===void 0)return;if(f!==null){const M=f.array;x=f.version;for(let E=0,v=M.length;E<v;E+=3){const w=M[E+0],b=M[E+1],A=M[E+2];u.push(w,b,b,A,A,w)}}else{const M=p.array;x=p.version;for(let E=0,v=M.length/3-1;E<v;E+=3){const w=E+0,b=E+1,A=E+2;u.push(w,b,b,A,A,w)}}const g=new(p.count>=65535?Qd:Jd)(u,1);g.version=x;const m=s.get(d);m&&t.remove(m),s.set(d,g)}function c(d){const u=s.get(d);if(u){const f=d.index;f!==null&&u.version<f.version&&h(d)}else h(d);return s.get(d)}return{get:o,update:l,getWireframeAttribute:c}}function Dx(r,t,e){let i;function n(d){i=d}let s,a;function o(d){s=d.type,a=d.bytesPerElement}function l(d,u){r.drawElements(i,u,s,d*a),e.update(u,i,1)}function h(d,u,f){f!==0&&(r.drawElementsInstanced(i,u,s,d*a,f),e.update(u,i,f))}function c(d,u,f){if(f===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,u,0,s,d,0,f);let x=0;for(let g=0;g<f;g++)x+=u[g];e.update(x,i,1)}this.setMode=n,this.setIndex=o,this.render=l,this.renderInstances=h,this.renderMultiDraw=c}function Ix(r){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,a,o){switch(e.calls++,a){case r.TRIANGLES:e.triangles+=o*(s/3);break;case r.LINES:e.lines+=o*(s/2);break;case r.LINE_STRIP:e.lines+=o*(s-1);break;case r.LINE_LOOP:e.lines+=o*s;break;case r.POINTS:e.points+=o*s;break;default:Zt("WebGLInfo: Unknown draw mode:",a);break}}function n(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:n,update:i}}function Lx(r,t,e){const i=new WeakMap,n=new _e;function s(a,o,l){const h=a.morphTargetInfluences,c=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,d=c!==void 0?c.length:0;let u=i.get(o);if(u===void 0||u.count!==d){let T=function(){A.dispose(),i.delete(o),o.removeEventListener("dispose",T)};u!==void 0&&u.texture.dispose();const f=o.morphAttributes.position!==void 0,p=o.morphAttributes.normal!==void 0,x=o.morphAttributes.color!==void 0,g=o.morphAttributes.position||[],m=o.morphAttributes.normal||[],M=o.morphAttributes.color||[];let E=0;f===!0&&(E=1),p===!0&&(E=2),x===!0&&(E=3);let v=o.attributes.position.count*E,w=1;v>t.maxTextureSize&&(w=Math.ceil(v/t.maxTextureSize),v=t.maxTextureSize);const b=new Float32Array(v*w*4*d),A=new Yd(b,v,w,d);A.type=wi,A.needsUpdate=!0;const _=E*4;for(let C=0;C<d;C++){const P=g[C],D=m[C],O=M[C],H=v*w*4*C;for(let F=0;F<P.count;F++){const q=F*_;f===!0&&(n.fromBufferAttribute(P,F),b[H+q+0]=n.x,b[H+q+1]=n.y,b[H+q+2]=n.z,b[H+q+3]=0),p===!0&&(n.fromBufferAttribute(D,F),b[H+q+4]=n.x,b[H+q+5]=n.y,b[H+q+6]=n.z,b[H+q+7]=0),x===!0&&(n.fromBufferAttribute(O,F),b[H+q+8]=n.x,b[H+q+9]=n.y,b[H+q+10]=n.z,b[H+q+11]=O.itemSize===4?n.w:1)}}u={count:d,texture:A,size:new Nt(v,w)},i.set(o,u),o.addEventListener("dispose",T)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(r,"morphTexture",a.morphTexture,e);else{let f=0;for(let x=0;x<h.length;x++)f+=h[x];const p=o.morphTargetsRelative?1:1-f;l.getUniforms().setValue(r,"morphTargetBaseInfluence",p),l.getUniforms().setValue(r,"morphTargetInfluences",h)}l.getUniforms().setValue(r,"morphTargetsTexture",u.texture,e),l.getUniforms().setValue(r,"morphTargetsTextureSize",u.size)}return{update:s}}function Nx(r,t,e,i,n){let s=new WeakMap;function a(h){const c=n.render.frame,d=h.geometry,u=t.get(h,d);if(s.get(u)!==c&&(t.update(u),s.set(u,c)),h.isInstancedMesh&&(h.hasEventListener("dispose",l)===!1&&h.addEventListener("dispose",l),s.get(h)!==c&&(e.update(h.instanceMatrix,r.ARRAY_BUFFER),h.instanceColor!==null&&e.update(h.instanceColor,r.ARRAY_BUFFER),s.set(h,c))),h.isSkinnedMesh){const f=h.skeleton;s.get(f)!==c&&(f.update(),s.set(f,c))}return u}function o(){s=new WeakMap}function l(h){const c=h.target;c.removeEventListener("dispose",l),i.releaseStatesOfObject(c),e.remove(c.instanceMatrix),c.instanceColor!==null&&e.remove(c.instanceColor)}return{update:a,dispose:o}}const Fx={[kh]:"LINEAR_TONE_MAPPING",[Bh]:"REINHARD_TONE_MAPPING",[Vh]:"CINEON_TONE_MAPPING",[Gh]:"ACES_FILMIC_TONE_MAPPING",[Hh]:"AGX_TONE_MAPPING",[Mo]:"NEUTRAL_TONE_MAPPING",[Fd]:"CUSTOM_TONE_MAPPING"};function Ux(r,t,e,i,n,s){const a=new Gi(t,e,{type:r,depthBuffer:n,stencilBuffer:s,samples:i?4:0,depthTexture:n?new ir(t,e):void 0}),o=new Gi(t,e,{type:ln,depthBuffer:!1,stencilBuffer:!1}),l=new Fn;l.setAttribute("position",new pi([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute("uv",new pi([0,2,0,0,2,0],2));const h=new Sm({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),c=new Se(l,h),d=new ac(-1,1,1,-1,0,1);let u=null,f=null,p=!1,x,g=null,m=[],M=!1;this.setSize=function(E,v){a.setSize(E,v),o.setSize(E,v);for(let w=0;w<m.length;w++){const b=m[w];b.setSize&&b.setSize(E,v)}},this.setEffects=function(E){m=E,M=m.length>0&&m[0].isRenderPass===!0;const v=a.width,w=a.height;for(let b=0;b<m.length;b++){const A=m[b];A.setSize&&A.setSize(v,w)}},this.begin=function(E,v){if(p||E.toneMapping===Ti&&m.length===0)return!1;if(g=v,v!==null){const w=v.width,b=v.height;(a.width!==w||a.height!==b)&&this.setSize(w,b)}return M===!1&&E.setRenderTarget(a),x=E.toneMapping,E.toneMapping=Ti,!0},this.hasRenderPass=function(){return M},this.end=function(E,v){E.toneMapping=x,p=!0;let w=a,b=o;for(let A=0;A<m.length;A++){const _=m[A];if(_.enabled!==!1&&(_.render(E,b,w,v),_.needsSwap!==!1)){const T=w;w=b,b=T}}if(u!==E.outputColorSpace||f!==E.toneMapping){u=E.outputColorSpace,f=E.toneMapping,h.defines={},$t.getTransfer(u)===te&&(h.defines.SRGB_TRANSFER="");const A=Fx[f];A&&(h.defines[A]=""),h.needsUpdate=!0}h.uniforms.tDiffuse.value=w.texture,E.setRenderTarget(g),E.render(c,d),g=null,p=!1},this.isCompositing=function(){return p},this.dispose=function(){a.depthTexture&&a.depthTexture.dispose(),a.dispose(),o.dispose(),l.dispose(),h.dispose()}}const gf=new Ci,Dh=new ir(1,1),xf=new Yd,_f=new tm,yf=new nf,hu=[],cu=[],uu=new Float32Array(16),du=new Float32Array(9),fu=new Float32Array(4);function or(r,t,e){const i=r[0];if(i<=0||i>0)return r;const n=t*e;let s=hu[n];if(s===void 0&&(s=new Float32Array(n),hu[n]=s),t!==0){i.toArray(s,0);for(let a=1,o=0;a!==t;++a)o+=e,r[a].toArray(s,o)}return s}function Ae(r,t){if(r.length!==t.length)return!1;for(let e=0,i=r.length;e<i;e++)if(r[e]!==t[e])return!1;return!0}function Re(r,t){for(let e=0,i=t.length;e<i;e++)r[e]=t[e]}function wo(r,t){let e=cu[t];e===void 0&&(e=new Int32Array(t),cu[t]=e);for(let i=0;i!==t;++i)e[i]=r.allocateTextureUnit();return e}function zx(r,t){const e=this.cache;e[0]!==t&&(r.uniform1f(this.addr,t),e[0]=t)}function Ox(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ae(e,t))return;r.uniform2fv(this.addr,t),Re(e,t)}}function kx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(r.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(Ae(e,t))return;r.uniform3fv(this.addr,t),Re(e,t)}}function Bx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ae(e,t))return;r.uniform4fv(this.addr,t),Re(e,t)}}function Vx(r,t){const e=this.cache,i=t.elements;if(i===void 0){if(Ae(e,t))return;r.uniformMatrix2fv(this.addr,!1,t),Re(e,t)}else{if(Ae(e,i))return;fu.set(i),r.uniformMatrix2fv(this.addr,!1,fu),Re(e,i)}}function Gx(r,t){const e=this.cache,i=t.elements;if(i===void 0){if(Ae(e,t))return;r.uniformMatrix3fv(this.addr,!1,t),Re(e,t)}else{if(Ae(e,i))return;du.set(i),r.uniformMatrix3fv(this.addr,!1,du),Re(e,i)}}function Hx(r,t){const e=this.cache,i=t.elements;if(i===void 0){if(Ae(e,t))return;r.uniformMatrix4fv(this.addr,!1,t),Re(e,t)}else{if(Ae(e,i))return;uu.set(i),r.uniformMatrix4fv(this.addr,!1,uu),Re(e,i)}}function Wx(r,t){const e=this.cache;e[0]!==t&&(r.uniform1i(this.addr,t),e[0]=t)}function Xx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ae(e,t))return;r.uniform2iv(this.addr,t),Re(e,t)}}function qx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Ae(e,t))return;r.uniform3iv(this.addr,t),Re(e,t)}}function $x(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ae(e,t))return;r.uniform4iv(this.addr,t),Re(e,t)}}function Yx(r,t){const e=this.cache;e[0]!==t&&(r.uniform1ui(this.addr,t),e[0]=t)}function Zx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(r.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ae(e,t))return;r.uniform2uiv(this.addr,t),Re(e,t)}}function Kx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(r.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Ae(e,t))return;r.uniform3uiv(this.addr,t),Re(e,t)}}function Jx(r,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(r.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ae(e,t))return;r.uniform4uiv(this.addr,t),Re(e,t)}}function Qx(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n);let s;this.type===r.SAMPLER_2D_SHADOW?(Dh.compareFunction=e.isReversedDepthBuffer()?Qh:Jh,s=Dh):s=gf,e.setTexture2D(t||s,n)}function jx(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n),e.setTexture3D(t||_f,n)}function t_(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n),e.setTextureCube(t||yf,n)}function e_(r,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(r.uniform1i(this.addr,n),i[0]=n),e.setTexture2DArray(t||xf,n)}function i_(r){switch(r){case 5126:return zx;case 35664:return Ox;case 35665:return kx;case 35666:return Bx;case 35674:return Vx;case 35675:return Gx;case 35676:return Hx;case 5124:case 35670:return Wx;case 35667:case 35671:return Xx;case 35668:case 35672:return qx;case 35669:case 35673:return $x;case 5125:return Yx;case 36294:return Zx;case 36295:return Kx;case 36296:return Jx;case 35678:case 36198:case 36298:case 36306:case 35682:return Qx;case 35679:case 36299:case 36307:return jx;case 35680:case 36300:case 36308:case 36293:return t_;case 36289:case 36303:case 36311:case 36292:return e_}}function n_(r,t){r.uniform1fv(this.addr,t)}function s_(r,t){const e=or(t,this.size,2);r.uniform2fv(this.addr,e)}function r_(r,t){const e=or(t,this.size,3);r.uniform3fv(this.addr,e)}function a_(r,t){const e=or(t,this.size,4);r.uniform4fv(this.addr,e)}function o_(r,t){const e=or(t,this.size,4);r.uniformMatrix2fv(this.addr,!1,e)}function l_(r,t){const e=or(t,this.size,9);r.uniformMatrix3fv(this.addr,!1,e)}function h_(r,t){const e=or(t,this.size,16);r.uniformMatrix4fv(this.addr,!1,e)}function c_(r,t){r.uniform1iv(this.addr,t)}function u_(r,t){r.uniform2iv(this.addr,t)}function d_(r,t){r.uniform3iv(this.addr,t)}function f_(r,t){r.uniform4iv(this.addr,t)}function p_(r,t){r.uniform1uiv(this.addr,t)}function m_(r,t){r.uniform2uiv(this.addr,t)}function g_(r,t){r.uniform3uiv(this.addr,t)}function x_(r,t){r.uniform4uiv(this.addr,t)}function __(r,t,e){const i=this.cache,n=t.length,s=wo(e,n);Ae(i,s)||(r.uniform1iv(this.addr,s),Re(i,s));let a;this.type===r.SAMPLER_2D_SHADOW?a=Dh:a=gf;for(let o=0;o!==n;++o)e.setTexture2D(t[o]||a,s[o])}function y_(r,t,e){const i=this.cache,n=t.length,s=wo(e,n);Ae(i,s)||(r.uniform1iv(this.addr,s),Re(i,s));for(let a=0;a!==n;++a)e.setTexture3D(t[a]||_f,s[a])}function v_(r,t,e){const i=this.cache,n=t.length,s=wo(e,n);Ae(i,s)||(r.uniform1iv(this.addr,s),Re(i,s));for(let a=0;a!==n;++a)e.setTextureCube(t[a]||yf,s[a])}function M_(r,t,e){const i=this.cache,n=t.length,s=wo(e,n);Ae(i,s)||(r.uniform1iv(this.addr,s),Re(i,s));for(let a=0;a!==n;++a)e.setTexture2DArray(t[a]||xf,s[a])}function b_(r){switch(r){case 5126:return n_;case 35664:return s_;case 35665:return r_;case 35666:return a_;case 35674:return o_;case 35675:return l_;case 35676:return h_;case 5124:case 35670:return c_;case 35667:case 35671:return u_;case 35668:case 35672:return d_;case 35669:case 35673:return f_;case 5125:return p_;case 36294:return m_;case 36295:return g_;case 36296:return x_;case 35678:case 36198:case 36298:case 36306:case 35682:return __;case 35679:case 36299:case 36307:return y_;case 35680:case 36300:case 36308:case 36293:return v_;case 36289:case 36303:case 36311:case 36292:return M_}}class S_{constructor(t,e,i){this.id=t,this.addr=i,this.cache=[],this.type=e.type,this.setValue=i_(e.type)}}class w_{constructor(t,e,i){this.id=t,this.addr=i,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=b_(e.type)}}class E_{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,i){const n=this.seq;for(let s=0,a=n.length;s!==a;++s){const o=n[s];o.setValue(t,e[o.id],i)}}}const al=/(\w+)(\])?(\[|\.)?/g;function pu(r,t){r.seq.push(t),r.map[t.id]=t}function T_(r,t,e){const i=r.name,n=i.length;for(al.lastIndex=0;;){const s=al.exec(i),a=al.lastIndex;let o=s[1];const l=s[2]==="]",h=s[3];if(l&&(o=o|0),h===void 0||h==="["&&a+2===n){pu(e,h===void 0?new S_(o,r,t):new w_(o,r,t));break}else{let d=e.map[o];d===void 0&&(d=new E_(o),pu(e,d)),e=d}}}class no{constructor(t,e){this.seq=[],this.map={};const i=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let a=0;a<i;++a){const o=t.getActiveUniform(e,a),l=t.getUniformLocation(e,o.name);T_(o,l,this)}const n=[],s=[];for(const a of this.seq)a.type===t.SAMPLER_2D_SHADOW||a.type===t.SAMPLER_CUBE_SHADOW||a.type===t.SAMPLER_2D_ARRAY_SHADOW?n.push(a):s.push(a);n.length>0&&(this.seq=n.concat(s))}setValue(t,e,i,n){const s=this.map[e];s!==void 0&&s.setValue(t,i,n)}setOptional(t,e,i){const n=e[i];n!==void 0&&this.setValue(t,i,n)}static upload(t,e,i,n){for(let s=0,a=e.length;s!==a;++s){const o=e[s],l=i[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,n)}}static seqWithValue(t,e){const i=[];for(let n=0,s=t.length;n!==s;++n){const a=t[n];a.id in e&&i.push(a)}return i}}function mu(r,t,e){const i=r.createShader(t);return r.shaderSource(i,e),r.compileShader(i),i}const A_=37297;let R_=0;function C_(r,t){const e=r.split(`
`),i=[],n=Math.max(t-6,0),s=Math.min(t+6,e.length);for(let a=n;a<s;a++){const o=a+1;i.push(`${o===t?">":" "} ${o}: ${e[a]}`)}return i.join(`
`)}const gu=new Ot;function P_(r){$t._getMatrix(gu,$t.workingColorSpace,r);const t=`mat3( ${gu.elements.map(e=>e.toFixed(4))} )`;switch($t.getTransfer(r)){case co:return[t,"LinearTransferOETF"];case te:return[t,"sRGBTransferOETF"];default:return Lt("WebGLProgram: Unsupported color space: ",r),[t,"LinearTransferOETF"]}}function xu(r,t,e){const i=r.getShaderParameter(t,r.COMPILE_STATUS),s=(r.getShaderInfoLog(t)||"").trim();if(i&&s==="")return"";const a=/ERROR: 0:(\d+)/.exec(s);if(a){const o=parseInt(a[1]);return e.toUpperCase()+`

`+s+`

`+C_(r.getShaderSource(t),o)}else return s}function D_(r,t){const e=P_(t);return[`vec4 ${r}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}const I_={[kh]:"Linear",[Bh]:"Reinhard",[Vh]:"Cineon",[Gh]:"ACESFilmic",[Hh]:"AgX",[Mo]:"Neutral",[Fd]:"Custom"};function L_(r,t){const e=I_[t];return e===void 0?(Lt("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+r+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+r+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const va=new U;function N_(){$t.getLuminanceCoefficients(va);const r=va.x.toFixed(4),t=va.y.toFixed(4),e=va.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${r}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function F_(r){return[r.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",r.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Pr).join(`
`)}function U_(r){const t=[];for(const e in r){const i=r[e];i!==!1&&t.push("#define "+e+" "+i)}return t.join(`
`)}function z_(r,t){const e={},i=r.getProgramParameter(t,r.ACTIVE_ATTRIBUTES);for(let n=0;n<i;n++){const s=r.getActiveAttrib(t,n),a=s.name;let o=1;s.type===r.FLOAT_MAT2&&(o=2),s.type===r.FLOAT_MAT3&&(o=3),s.type===r.FLOAT_MAT4&&(o=4),e[a]={type:s.type,location:r.getAttribLocation(t,a),locationSize:o}}return e}function Pr(r){return r!==""}function _u(r,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return r.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function yu(r,t){return r.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const O_=/^[ \t]*#include +<([\w\d./]+)>/gm;function Ih(r){return r.replace(O_,B_)}const k_=new Map;function B_(r,t){let e=Vt[t];if(e===void 0){const i=k_.get(t);if(i!==void 0)e=Vt[i],Lt('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,i);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return Ih(e)}const V_=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function vu(r){return r.replace(V_,G_)}function G_(r,t,e,i){let n="";for(let s=parseInt(t);s<parseInt(e);s++)n+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return n}function Mu(r){let t=`precision ${r.precision} float;
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
#define LOW_PRECISION`),t}const H_={[Za]:"SHADOWMAP_TYPE_PCF",[Cr]:"SHADOWMAP_TYPE_VSM"};function W_(r){return H_[r.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}const X_={[Kn]:"ENVMAP_TYPE_CUBE",[er]:"ENVMAP_TYPE_CUBE",[bo]:"ENVMAP_TYPE_CUBE_UV"};function q_(r){return r.envMap===!1?"ENVMAP_TYPE_CUBE":X_[r.envMapMode]||"ENVMAP_TYPE_CUBE"}const $_={[er]:"ENVMAP_MODE_REFRACTION"};function Y_(r){return r.envMap===!1?"ENVMAP_MODE_REFLECTION":$_[r.envMapMode]||"ENVMAP_MODE_REFLECTION"}const Z_={[Oh]:"ENVMAP_BLENDING_MULTIPLY",[_p]:"ENVMAP_BLENDING_MIX",[yp]:"ENVMAP_BLENDING_ADD"};function K_(r){return r.envMap===!1?"ENVMAP_BLENDING_NONE":Z_[r.combine]||"ENVMAP_BLENDING_NONE"}function J_(r){const t=r.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,i=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:i,maxMip:e}}function Q_(r,t,e,i){const n=r.getContext(),s=e.defines;let a=e.vertexShader,o=e.fragmentShader;const l=W_(e),h=q_(e),c=Y_(e),d=K_(e),u=J_(e),f=F_(e),p=U_(s),x=n.createProgram();let g,m,M=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(g=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p].filter(Pr).join(`
`),g.length>0&&(g+=`
`),m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p].filter(Pr).join(`
`),m.length>0&&(m+=`
`)):(g=[Mu(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexNormals?"#define HAS_NORMAL":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Pr).join(`
`),m=[Mu(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.envMap?"#define "+c:"",e.envMap?"#define "+d:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor?"#define USE_COLOR":"",e.vertexAlphas||e.batchingColor?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==Ti?"#define TONE_MAPPING":"",e.toneMapping!==Ti?Vt.tonemapping_pars_fragment:"",e.toneMapping!==Ti?L_("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Vt.colorspace_pars_fragment,D_("linearToOutputTexel",e.outputColorSpace),N_(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(Pr).join(`
`)),a=Ih(a),a=_u(a,e),a=yu(a,e),o=Ih(o),o=_u(o,e),o=yu(o,e),a=vu(a),o=vu(o),e.isRawShaderMaterial!==!0&&(M=`#version 300 es
`,g=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,m=["#define varying in",e.glslVersion===Ac?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===Ac?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+m);const E=M+g+a,v=M+m+o,w=mu(n,n.VERTEX_SHADER,E),b=mu(n,n.FRAGMENT_SHADER,v);n.attachShader(x,w),n.attachShader(x,b),e.index0AttributeName!==void 0?n.bindAttribLocation(x,0,e.index0AttributeName):e.hasPositionAttribute===!0&&n.bindAttribLocation(x,0,"position"),n.linkProgram(x);function A(P){if(r.debug.checkShaderErrors){const D=n.getProgramInfoLog(x)||"",O=n.getShaderInfoLog(w)||"",H=n.getShaderInfoLog(b)||"",F=D.trim(),q=O.trim(),G=H.trim();let J=!0,et=!0;if(n.getProgramParameter(x,n.LINK_STATUS)===!1)if(J=!1,typeof r.debug.onShaderError=="function")r.debug.onShaderError(n,x,w,b);else{const at=xu(n,w,"vertex"),rt=xu(n,b,"fragment");Zt("WebGLProgram: Shader Error "+n.getError()+" - VALIDATE_STATUS "+n.getProgramParameter(x,n.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+F+`
`+at+`
`+rt)}else F!==""?Lt("WebGLProgram: Program Info Log:",F):(q===""||G==="")&&(et=!1);et&&(P.diagnostics={runnable:J,programLog:F,vertexShader:{log:q,prefix:g},fragmentShader:{log:G,prefix:m}})}n.deleteShader(w),n.deleteShader(b),_=new no(n,x),T=z_(n,x)}let _;this.getUniforms=function(){return _===void 0&&A(this),_};let T;this.getAttributes=function(){return T===void 0&&A(this),T};let C=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return C===!1&&(C=n.getProgramParameter(x,A_)),C},this.destroy=function(){i.releaseStatesOfProgram(this),n.deleteProgram(x),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=R_++,this.cacheKey=t,this.usedTimes=1,this.program=x,this.vertexShader=w,this.fragmentShader=b,this}let j_=0;class ty{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,e,i){const n=this._getShaderCacheForMaterial(t);return n.has(e)===!1&&(n.add(e),e.usedTimes++),n.has(i)===!1&&(n.add(i),i.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const i of e)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let i=e.get(t);return i===void 0&&(i=new Set,e.set(t,i)),i}_getShaderStage(t){const e=this.shaderCache;let i=e.get(t);return i===void 0&&(i=new ey(t),e.set(t,i)),i}}class ey{constructor(t){this.id=j_++,this.code=t,this.usedTimes=0}}function iy(r){return r===Jn||r===ao||r===oo}function ny(r,t,e,i,n,s){const a=new ec,o=new ty,l=new Set,h=[],c=new Map,d=i.logarithmicDepthBuffer;let u=i.precision;const f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function p(_){return l.add(_),_===0?"uv":`uv${_}`}function x(_,T,C,P,D,O){const H=P.fog,F=D.geometry,q=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?P.environment:null,G=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,J=t.get(_.envMap||q,G),et=J&&J.mapping===bo?J.image.height:null,at=f[_.type];_.precision!==null&&(u=i.getMaxPrecision(_.precision),u!==_.precision&&Lt("WebGLProgram.getParameters:",_.precision,"not supported, using",u,"instead."));const rt=F.morphAttributes.position||F.morphAttributes.normal||F.morphAttributes.color,k=rt!==void 0?rt.length:0;let xt=0;F.morphAttributes.position!==void 0&&(xt=1),F.morphAttributes.normal!==void 0&&(xt=2),F.morphAttributes.color!==void 0&&(xt=3);let wt,Ct,Y,nt;if(at){const vt=Oi[at];wt=vt.vertexShader,Ct=vt.fragmentShader}else{wt=_.vertexShader,Ct=_.fragmentShader;const vt=o.getVertexShaderStage(_),fe=o.getFragmentShaderStage(_);o.update(_,vt,fe),Y=vt.id,nt=fe.id}const it=r.getRenderTarget(),Dt=r.state.buffers.depth.getReversed(),bt=D.isInstancedMesh===!0,At=D.isBatchedMesh===!0,ce=!!_.map,kt=!!_.matcap,Qt=!!J,Xt=!!_.aoMap,Kt=!!_.lightMap,ye=!!_.bumpMap&&_.wireframe===!1,we=!!_.normalMap,Ce=!!_.displacementMap,Ie=!!_.emissiveMap,de=!!_.metalnessMap,ve=!!_.roughnessMap,L=_.anisotropy>0,Ke=_.clearcoat>0,jt=_.dispersion>0,R=_.iridescence>0,y=_.sheen>0,z=_.transmission>0,W=L&&!!_.anisotropyMap,Z=Ke&&!!_.clearcoatMap,st=Ke&&!!_.clearcoatNormalMap,lt=Ke&&!!_.clearcoatRoughnessMap,K=R&&!!_.iridescenceMap,j=R&&!!_.iridescenceThicknessMap,ht=y&&!!_.sheenColorMap,Et=y&&!!_.sheenRoughnessMap,dt=!!_.specularMap,ct=!!_.specularColorMap,Pt=!!_.specularIntensityMap,It=z&&!!_.transmissionMap,Ut=z&&!!_.thicknessMap,I=!!_.gradientMap,ot=!!_.alphaMap,Q=_.alphaTest>0,ut=!!_.alphaHash,gt=!!_.extensions;let tt=Ti;_.toneMapped&&(it===null||it.isXRRenderTarget===!0)&&(tt=r.toneMapping);const St={shaderID:at,shaderType:_.type,shaderName:_.name,vertexShader:wt,fragmentShader:Ct,defines:_.defines,customVertexShaderID:Y,customFragmentShaderID:nt,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:u,batching:At,batchingColor:At&&D._colorsTexture!==null,instancing:bt,instancingColor:bt&&D.instanceColor!==null,instancingMorph:bt&&D.morphTexture!==null,outputColorSpace:it===null?r.outputColorSpace:it.isXRRenderTarget===!0?it.texture.colorSpace:$t.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:ce,matcap:kt,envMap:Qt,envMapMode:Qt&&J.mapping,envMapCubeUVHeight:et,aoMap:Xt,lightMap:Kt,bumpMap:ye,normalMap:we,displacementMap:Ce,emissiveMap:Ie,normalMapObjectSpace:we&&_.normalMapType===bp,normalMapTangentSpace:we&&_.normalMapType===lo,packedNormalMap:we&&_.normalMapType===lo&&iy(_.normalMap.format),metalnessMap:de,roughnessMap:ve,anisotropy:L,anisotropyMap:W,clearcoat:Ke,clearcoatMap:Z,clearcoatNormalMap:st,clearcoatRoughnessMap:lt,dispersion:jt,iridescence:R,iridescenceMap:K,iridescenceThicknessMap:j,sheen:y,sheenColorMap:ht,sheenRoughnessMap:Et,specularMap:dt,specularColorMap:ct,specularIntensityMap:Pt,transmission:z,transmissionMap:It,thicknessMap:Ut,gradientMap:I,opaque:_.transparent===!1&&_.blending===$s&&_.alphaToCoverage===!1,alphaMap:ot,alphaTest:Q,alphaHash:ut,combine:_.combine,mapUv:ce&&p(_.map.channel),aoMapUv:Xt&&p(_.aoMap.channel),lightMapUv:Kt&&p(_.lightMap.channel),bumpMapUv:ye&&p(_.bumpMap.channel),normalMapUv:we&&p(_.normalMap.channel),displacementMapUv:Ce&&p(_.displacementMap.channel),emissiveMapUv:Ie&&p(_.emissiveMap.channel),metalnessMapUv:de&&p(_.metalnessMap.channel),roughnessMapUv:ve&&p(_.roughnessMap.channel),anisotropyMapUv:W&&p(_.anisotropyMap.channel),clearcoatMapUv:Z&&p(_.clearcoatMap.channel),clearcoatNormalMapUv:st&&p(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:lt&&p(_.clearcoatRoughnessMap.channel),iridescenceMapUv:K&&p(_.iridescenceMap.channel),iridescenceThicknessMapUv:j&&p(_.iridescenceThicknessMap.channel),sheenColorMapUv:ht&&p(_.sheenColorMap.channel),sheenRoughnessMapUv:Et&&p(_.sheenRoughnessMap.channel),specularMapUv:dt&&p(_.specularMap.channel),specularColorMapUv:ct&&p(_.specularColorMap.channel),specularIntensityMapUv:Pt&&p(_.specularIntensityMap.channel),transmissionMapUv:It&&p(_.transmissionMap.channel),thicknessMapUv:Ut&&p(_.thicknessMap.channel),alphaMapUv:ot&&p(_.alphaMap.channel),vertexTangents:!!F.attributes.tangent&&(we||L),vertexNormals:!!F.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!F.attributes.color&&F.attributes.color.itemSize===4,pointsUvs:D.isPoints===!0&&!!F.attributes.uv&&(ce||ot),fog:!!H,useFog:_.fog===!0,fogExp2:!!H&&H.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||F.attributes.normal===void 0&&we===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:Dt,skinning:D.isSkinnedMesh===!0,hasPositionAttribute:F.attributes.position!==void 0,morphTargets:F.morphAttributes.position!==void 0,morphNormals:F.morphAttributes.normal!==void 0,morphColors:F.morphAttributes.color!==void 0,morphTargetsCount:k,morphTextureStride:xt,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numLightProbeGrids:O.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:_.dithering,shadowMapEnabled:r.shadowMap.enabled&&C.length>0,shadowMapType:r.shadowMap.type,toneMapping:tt,decodeVideoTexture:ce&&_.map.isVideoTexture===!0&&$t.getTransfer(_.map.colorSpace)===te,decodeVideoTextureEmissive:Ie&&_.emissiveMap.isVideoTexture===!0&&$t.getTransfer(_.emissiveMap.colorSpace)===te,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===en,flipSided:_.side===Ue,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:gt&&_.extensions.clipCullDistance===!0&&e.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(gt&&_.extensions.multiDraw===!0||At)&&e.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:e.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return St.vertexUv1s=l.has(1),St.vertexUv2s=l.has(2),St.vertexUv3s=l.has(3),l.clear(),St}function g(_){const T=[];if(_.shaderID?T.push(_.shaderID):(T.push(_.customVertexShaderID),T.push(_.customFragmentShaderID)),_.defines!==void 0)for(const C in _.defines)T.push(C),T.push(_.defines[C]);return _.isRawShaderMaterial===!1&&(m(T,_),M(T,_),T.push(r.outputColorSpace)),T.push(_.customProgramCacheKey),T.join()}function m(_,T){_.push(T.precision),_.push(T.outputColorSpace),_.push(T.envMapMode),_.push(T.envMapCubeUVHeight),_.push(T.mapUv),_.push(T.alphaMapUv),_.push(T.lightMapUv),_.push(T.aoMapUv),_.push(T.bumpMapUv),_.push(T.normalMapUv),_.push(T.displacementMapUv),_.push(T.emissiveMapUv),_.push(T.metalnessMapUv),_.push(T.roughnessMapUv),_.push(T.anisotropyMapUv),_.push(T.clearcoatMapUv),_.push(T.clearcoatNormalMapUv),_.push(T.clearcoatRoughnessMapUv),_.push(T.iridescenceMapUv),_.push(T.iridescenceThicknessMapUv),_.push(T.sheenColorMapUv),_.push(T.sheenRoughnessMapUv),_.push(T.specularMapUv),_.push(T.specularColorMapUv),_.push(T.specularIntensityMapUv),_.push(T.transmissionMapUv),_.push(T.thicknessMapUv),_.push(T.combine),_.push(T.fogExp2),_.push(T.sizeAttenuation),_.push(T.morphTargetsCount),_.push(T.morphAttributeCount),_.push(T.numDirLights),_.push(T.numPointLights),_.push(T.numSpotLights),_.push(T.numSpotLightMaps),_.push(T.numHemiLights),_.push(T.numRectAreaLights),_.push(T.numDirLightShadows),_.push(T.numPointLightShadows),_.push(T.numSpotLightShadows),_.push(T.numSpotLightShadowsWithMaps),_.push(T.numLightProbes),_.push(T.shadowMapType),_.push(T.toneMapping),_.push(T.numClippingPlanes),_.push(T.numClipIntersection),_.push(T.depthPacking)}function M(_,T){a.disableAll(),T.instancing&&a.enable(0),T.instancingColor&&a.enable(1),T.instancingMorph&&a.enable(2),T.matcap&&a.enable(3),T.envMap&&a.enable(4),T.normalMapObjectSpace&&a.enable(5),T.normalMapTangentSpace&&a.enable(6),T.clearcoat&&a.enable(7),T.iridescence&&a.enable(8),T.alphaTest&&a.enable(9),T.vertexColors&&a.enable(10),T.vertexAlphas&&a.enable(11),T.vertexUv1s&&a.enable(12),T.vertexUv2s&&a.enable(13),T.vertexUv3s&&a.enable(14),T.vertexTangents&&a.enable(15),T.anisotropy&&a.enable(16),T.alphaHash&&a.enable(17),T.batching&&a.enable(18),T.dispersion&&a.enable(19),T.batchingColor&&a.enable(20),T.gradientMap&&a.enable(21),T.packedNormalMap&&a.enable(22),T.vertexNormals&&a.enable(23),_.push(a.mask),a.disableAll(),T.fog&&a.enable(0),T.useFog&&a.enable(1),T.flatShading&&a.enable(2),T.logarithmicDepthBuffer&&a.enable(3),T.reversedDepthBuffer&&a.enable(4),T.skinning&&a.enable(5),T.morphTargets&&a.enable(6),T.morphNormals&&a.enable(7),T.morphColors&&a.enable(8),T.premultipliedAlpha&&a.enable(9),T.shadowMapEnabled&&a.enable(10),T.doubleSided&&a.enable(11),T.flipSided&&a.enable(12),T.useDepthPacking&&a.enable(13),T.dithering&&a.enable(14),T.transmission&&a.enable(15),T.sheen&&a.enable(16),T.opaque&&a.enable(17),T.pointsUvs&&a.enable(18),T.decodeVideoTexture&&a.enable(19),T.decodeVideoTextureEmissive&&a.enable(20),T.alphaToCoverage&&a.enable(21),T.numLightProbeGrids>0&&a.enable(22),T.hasPositionAttribute&&a.enable(23),_.push(a.mask)}function E(_){const T=f[_.type];let C;if(T){const P=Oi[T];C=hf.clone(P.uniforms)}else C=_.uniforms;return C}function v(_,T){let C=c.get(T);return C!==void 0?++C.usedTimes:(C=new Q_(r,T,_,n),h.push(C),c.set(T,C)),C}function w(_){if(--_.usedTimes===0){const T=h.indexOf(_);h[T]=h[h.length-1],h.pop(),c.delete(_.cacheKey),_.destroy()}}function b(_){o.remove(_)}function A(){o.dispose()}return{getParameters:x,getProgramCacheKey:g,getUniforms:E,acquireProgram:v,releaseProgram:w,releaseShaderCache:b,programs:h,dispose:A}}function sy(){let r=new WeakMap;function t(a){return r.has(a)}function e(a){let o=r.get(a);return o===void 0&&(o={},r.set(a,o)),o}function i(a){r.delete(a)}function n(a,o,l){r.get(a)[o]=l}function s(){r=new WeakMap}return{has:t,get:e,remove:i,update:n,dispose:s}}function ry(r,t){return r.groupOrder!==t.groupOrder?r.groupOrder-t.groupOrder:r.renderOrder!==t.renderOrder?r.renderOrder-t.renderOrder:r.material.id!==t.material.id?r.material.id-t.material.id:r.materialVariant!==t.materialVariant?r.materialVariant-t.materialVariant:r.z!==t.z?r.z-t.z:r.id-t.id}function bu(r,t){return r.groupOrder!==t.groupOrder?r.groupOrder-t.groupOrder:r.renderOrder!==t.renderOrder?r.renderOrder-t.renderOrder:r.z!==t.z?t.z-r.z:r.id-t.id}function Su(){const r=[];let t=0;const e=[],i=[],n=[];function s(){t=0,e.length=0,i.length=0,n.length=0}function a(u){let f=0;return u.isInstancedMesh&&(f+=2),u.isSkinnedMesh&&(f+=1),f}function o(u,f,p,x,g,m){let M=r[t];return M===void 0?(M={id:u.id,object:u,geometry:f,material:p,materialVariant:a(u),groupOrder:x,renderOrder:u.renderOrder,z:g,group:m},r[t]=M):(M.id=u.id,M.object=u,M.geometry=f,M.material=p,M.materialVariant=a(u),M.groupOrder=x,M.renderOrder=u.renderOrder,M.z=g,M.group=m),t++,M}function l(u,f,p,x,g,m){const M=o(u,f,p,x,g,m);p.transmission>0?i.push(M):p.transparent===!0?n.push(M):e.push(M)}function h(u,f,p,x,g,m){const M=o(u,f,p,x,g,m);p.transmission>0?i.unshift(M):p.transparent===!0?n.unshift(M):e.unshift(M)}function c(u,f,p){e.length>1&&e.sort(u||ry),i.length>1&&i.sort(f||bu),n.length>1&&n.sort(f||bu),p&&(e.reverse(),i.reverse(),n.reverse())}function d(){for(let u=t,f=r.length;u<f;u++){const p=r[u];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:i,transparent:n,init:s,push:l,unshift:h,finish:d,sort:c}}function ay(){let r=new WeakMap;function t(i,n){const s=r.get(i);let a;return s===void 0?(a=new Su,r.set(i,[a])):n>=s.length?(a=new Su,s.push(a)):a=s[n],a}function e(){r=new WeakMap}return{get:t,dispose:e}}function oy(){const r={};return{get:function(t){if(r[t.id]!==void 0)return r[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new U,color:new Ft};break;case"SpotLight":e={position:new U,direction:new U,color:new Ft,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new U,color:new Ft,distance:0,decay:0};break;case"HemisphereLight":e={direction:new U,skyColor:new Ft,groundColor:new Ft};break;case"RectAreaLight":e={color:new Ft,position:new U,halfWidth:new U,halfHeight:new U};break}return r[t.id]=e,e}}}function ly(){const r={};return{get:function(t){if(r[t.id]!==void 0)return r[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Nt};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Nt};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Nt,shadowCameraNear:1,shadowCameraFar:1e3};break}return r[t.id]=e,e}}}let hy=0;function cy(r,t){return(t.castShadow?2:0)-(r.castShadow?2:0)+(t.map?1:0)-(r.map?1:0)}function uy(r){const t=new oy,e=ly(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)i.probe.push(new U);const n=new U,s=new ue,a=new ue;function o(h){let c=0,d=0,u=0;for(let T=0;T<9;T++)i.probe[T].set(0,0,0);let f=0,p=0,x=0,g=0,m=0,M=0,E=0,v=0,w=0,b=0,A=0;h.sort(cy);for(let T=0,C=h.length;T<C;T++){const P=h[T],D=P.color,O=P.intensity,H=P.distance;let F=null;if(P.shadow&&P.shadow.map&&(P.shadow.map.texture.format===Jn?F=P.shadow.map.texture:F=P.shadow.map.depthTexture||P.shadow.map.texture),P.isAmbientLight)c+=D.r*O,d+=D.g*O,u+=D.b*O;else if(P.isLightProbe){for(let q=0;q<9;q++)i.probe[q].addScaledVector(P.sh.coefficients[q],O);A++}else if(P.isDirectionalLight){const q=t.get(P);if(q.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){const G=P.shadow,J=e.get(P);J.shadowIntensity=G.intensity,J.shadowBias=G.bias,J.shadowNormalBias=G.normalBias,J.shadowRadius=G.radius,J.shadowMapSize=G.mapSize,i.directionalShadow[f]=J,i.directionalShadowMap[f]=F,i.directionalShadowMatrix[f]=P.shadow.matrix,M++}i.directional[f]=q,f++}else if(P.isSpotLight){const q=t.get(P);q.position.setFromMatrixPosition(P.matrixWorld),q.color.copy(D).multiplyScalar(O),q.distance=H,q.coneCos=Math.cos(P.angle),q.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),q.decay=P.decay,i.spot[x]=q;const G=P.shadow;if(P.map&&(i.spotLightMap[w]=P.map,w++,G.updateMatrices(P),P.castShadow&&b++),i.spotLightMatrix[x]=G.matrix,P.castShadow){const J=e.get(P);J.shadowIntensity=G.intensity,J.shadowBias=G.bias,J.shadowNormalBias=G.normalBias,J.shadowRadius=G.radius,J.shadowMapSize=G.mapSize,i.spotShadow[x]=J,i.spotShadowMap[x]=F,v++}x++}else if(P.isRectAreaLight){const q=t.get(P);q.color.copy(D).multiplyScalar(O),q.halfWidth.set(P.width*.5,0,0),q.halfHeight.set(0,P.height*.5,0),i.rectArea[g]=q,g++}else if(P.isPointLight){const q=t.get(P);if(q.color.copy(P.color).multiplyScalar(P.intensity),q.distance=P.distance,q.decay=P.decay,P.castShadow){const G=P.shadow,J=e.get(P);J.shadowIntensity=G.intensity,J.shadowBias=G.bias,J.shadowNormalBias=G.normalBias,J.shadowRadius=G.radius,J.shadowMapSize=G.mapSize,J.shadowCameraNear=G.camera.near,J.shadowCameraFar=G.camera.far,i.pointShadow[p]=J,i.pointShadowMap[p]=F,i.pointShadowMatrix[p]=P.shadow.matrix,E++}i.point[p]=q,p++}else if(P.isHemisphereLight){const q=t.get(P);q.skyColor.copy(P.color).multiplyScalar(O),q.groundColor.copy(P.groundColor).multiplyScalar(O),i.hemi[m]=q,m++}}g>0&&(r.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=ft.LTC_FLOAT_1,i.rectAreaLTC2=ft.LTC_FLOAT_2):(i.rectAreaLTC1=ft.LTC_HALF_1,i.rectAreaLTC2=ft.LTC_HALF_2)),i.ambient[0]=c,i.ambient[1]=d,i.ambient[2]=u;const _=i.hash;(_.directionalLength!==f||_.pointLength!==p||_.spotLength!==x||_.rectAreaLength!==g||_.hemiLength!==m||_.numDirectionalShadows!==M||_.numPointShadows!==E||_.numSpotShadows!==v||_.numSpotMaps!==w||_.numLightProbes!==A)&&(i.directional.length=f,i.spot.length=x,i.rectArea.length=g,i.point.length=p,i.hemi.length=m,i.directionalShadow.length=M,i.directionalShadowMap.length=M,i.pointShadow.length=E,i.pointShadowMap.length=E,i.spotShadow.length=v,i.spotShadowMap.length=v,i.directionalShadowMatrix.length=M,i.pointShadowMatrix.length=E,i.spotLightMatrix.length=v+w-b,i.spotLightMap.length=w,i.numSpotLightShadowsWithMaps=b,i.numLightProbes=A,_.directionalLength=f,_.pointLength=p,_.spotLength=x,_.rectAreaLength=g,_.hemiLength=m,_.numDirectionalShadows=M,_.numPointShadows=E,_.numSpotShadows=v,_.numSpotMaps=w,_.numLightProbes=A,i.version=hy++)}function l(h,c){let d=0,u=0,f=0,p=0,x=0;const g=c.matrixWorldInverse;for(let m=0,M=h.length;m<M;m++){const E=h[m];if(E.isDirectionalLight){const v=i.directional[d];v.direction.setFromMatrixPosition(E.matrixWorld),n.setFromMatrixPosition(E.target.matrixWorld),v.direction.sub(n),v.direction.transformDirection(g),d++}else if(E.isSpotLight){const v=i.spot[f];v.position.setFromMatrixPosition(E.matrixWorld),v.position.applyMatrix4(g),v.direction.setFromMatrixPosition(E.matrixWorld),n.setFromMatrixPosition(E.target.matrixWorld),v.direction.sub(n),v.direction.transformDirection(g),f++}else if(E.isRectAreaLight){const v=i.rectArea[p];v.position.setFromMatrixPosition(E.matrixWorld),v.position.applyMatrix4(g),a.identity(),s.copy(E.matrixWorld),s.premultiply(g),a.extractRotation(s),v.halfWidth.set(E.width*.5,0,0),v.halfHeight.set(0,E.height*.5,0),v.halfWidth.applyMatrix4(a),v.halfHeight.applyMatrix4(a),p++}else if(E.isPointLight){const v=i.point[u];v.position.setFromMatrixPosition(E.matrixWorld),v.position.applyMatrix4(g),u++}else if(E.isHemisphereLight){const v=i.hemi[x];v.direction.setFromMatrixPosition(E.matrixWorld),v.direction.transformDirection(g),x++}}}return{setup:o,setupView:l,state:i}}function wu(r){const t=new uy(r),e=[],i=[],n=[];function s(u){d.camera=u,e.length=0,i.length=0,n.length=0}function a(u){e.push(u)}function o(u){i.push(u)}function l(u){n.push(u)}function h(){t.setup(e)}function c(u){t.setupView(e,u)}const d={lightsArray:e,shadowsArray:i,lightProbeGridArray:n,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:d,setupLights:h,setupLightsView:c,pushLight:a,pushShadow:o,pushLightProbeGrid:l}}function dy(r){let t=new WeakMap;function e(n,s=0){const a=t.get(n);let o;return a===void 0?(o=new wu(r),t.set(n,[o])):s>=a.length?(o=new wu(r),a.push(o)):o=a[s],o}function i(){t=new WeakMap}return{get:e,dispose:i}}const fy=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,py=`uniform sampler2D shadow_pass;
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
}`,my=[new U(1,0,0),new U(-1,0,0),new U(0,1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1)],gy=[new U(0,-1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1),new U(0,-1,0),new U(0,-1,0)],Eu=new ue,_r=new U,ol=new U;function xy(r,t,e){let i=new rc;const n=new Nt,s=new Nt,a=new _e,o=new Em,l=new Tm,h={},c=e.maxTextureSize,d={[Dn]:Ue,[Ue]:Dn,[en]:en},u=new gi({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Nt},radius:{value:4}},vertexShader:fy,fragmentShader:py}),f=u.clone();f.defines.HORIZONTAL_PASS=1;const p=new Fn;p.setAttribute("position",new Ai(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const x=new Se(p,u),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Za;let m=this.type;this.render=function(b,A,_){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||b.length===0)return;this.type===Nd&&(Lt("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=Za);const T=r.getRenderTarget(),C=r.getActiveCubeFace(),P=r.getActiveMipmapLevel(),D=r.state;D.setBlending(sn),D.buffers.depth.getReversed()===!0?D.buffers.color.setClear(0,0,0,0):D.buffers.color.setClear(1,1,1,1),D.buffers.depth.setTest(!0),D.setScissorTest(!1);const O=m!==this.type;O&&A.traverse(function(H){H.material&&(Array.isArray(H.material)?H.material.forEach(F=>F.needsUpdate=!0):H.material.needsUpdate=!0)});for(let H=0,F=b.length;H<F;H++){const q=b[H],G=q.shadow;if(G===void 0){Lt("WebGLShadowMap:",q,"has no shadow.");continue}if(G.autoUpdate===!1&&G.needsUpdate===!1)continue;n.copy(G.mapSize);const J=G.getFrameExtents();n.multiply(J),s.copy(G.mapSize),(n.x>c||n.y>c)&&(n.x>c&&(s.x=Math.floor(c/J.x),n.x=s.x*J.x,G.mapSize.x=s.x),n.y>c&&(s.y=Math.floor(c/J.y),n.y=s.y*J.y,G.mapSize.y=s.y));const et=r.state.buffers.depth.getReversed();if(G.camera._reversedDepth=et,G.map===null||O===!0){if(G.map!==null&&(G.map.depthTexture!==null&&(G.map.depthTexture.dispose(),G.map.depthTexture=null),G.map.dispose()),this.type===Cr){if(q.isPointLight){Lt("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}G.map=new Gi(n.x,n.y,{format:Jn,type:ln,minFilter:He,magFilter:He,generateMipmaps:!1}),G.map.texture.name=q.name+".shadowMap",G.map.depthTexture=new ir(n.x,n.y,wi),G.map.depthTexture.name=q.name+".shadowMapDepth",G.map.depthTexture.format=hn,G.map.depthTexture.compareFunction=null,G.map.depthTexture.minFilter=Ne,G.map.depthTexture.magFilter=Ne}else q.isPointLight?(G.map=new mf(n.x),G.map.depthTexture=new _m(n.x,Hi)):(G.map=new Gi(n.x,n.y),G.map.depthTexture=new ir(n.x,n.y,Hi)),G.map.depthTexture.name=q.name+".shadowMap",G.map.depthTexture.format=hn,this.type===Za?(G.map.depthTexture.compareFunction=et?Qh:Jh,G.map.depthTexture.minFilter=He,G.map.depthTexture.magFilter=He):(G.map.depthTexture.compareFunction=null,G.map.depthTexture.minFilter=Ne,G.map.depthTexture.magFilter=Ne);G.camera.updateProjectionMatrix()}const at=G.map.isWebGLCubeRenderTarget?6:1;for(let rt=0;rt<at;rt++){if(G.map.isWebGLCubeRenderTarget)r.setRenderTarget(G.map,rt),r.clear();else{rt===0&&(r.setRenderTarget(G.map),r.clear());const k=G.getViewport(rt);a.set(s.x*k.x,s.y*k.y,s.x*k.z,s.y*k.w),D.viewport(a)}if(q.isPointLight){const k=G.camera,xt=G.matrix,wt=q.distance||k.far;wt!==k.far&&(k.far=wt,k.updateProjectionMatrix()),_r.setFromMatrixPosition(q.matrixWorld),k.position.copy(_r),ol.copy(k.position),ol.add(my[rt]),k.up.copy(gy[rt]),k.lookAt(ol),k.updateMatrixWorld(),xt.makeTranslation(-_r.x,-_r.y,-_r.z),Eu.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),G._frustum.setFromProjectionMatrix(Eu,k.coordinateSystem,k.reversedDepth)}else G.updateMatrices(q);i=G.getFrustum(),v(A,_,G.camera,q,this.type)}G.isPointLightShadow!==!0&&this.type===Cr&&M(G,_),G.needsUpdate=!1}m=this.type,g.needsUpdate=!1,r.setRenderTarget(T,C,P)};function M(b,A){const _=t.update(x);u.defines.VSM_SAMPLES!==b.blurSamples&&(u.defines.VSM_SAMPLES=b.blurSamples,f.defines.VSM_SAMPLES=b.blurSamples,u.needsUpdate=!0,f.needsUpdate=!0),b.mapPass===null&&(b.mapPass=new Gi(n.x,n.y,{format:Jn,type:ln})),u.uniforms.shadow_pass.value=b.map.depthTexture,u.uniforms.resolution.value=b.mapSize,u.uniforms.radius.value=b.radius,r.setRenderTarget(b.mapPass),r.clear(),r.renderBufferDirect(A,null,_,u,x,null),f.uniforms.shadow_pass.value=b.mapPass.texture,f.uniforms.resolution.value=b.mapSize,f.uniforms.radius.value=b.radius,r.setRenderTarget(b.map),r.clear(),r.renderBufferDirect(A,null,_,f,x,null)}function E(b,A,_,T){let C=null;const P=_.isPointLight===!0?b.customDistanceMaterial:b.customDepthMaterial;if(P!==void 0)C=P;else if(C=_.isPointLight===!0?l:o,r.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0||A.alphaToCoverage===!0){const D=C.uuid,O=A.uuid;let H=h[D];H===void 0&&(H={},h[D]=H);let F=H[O];F===void 0&&(F=C.clone(),H[O]=F,A.addEventListener("dispose",w)),C=F}if(C.visible=A.visible,C.wireframe=A.wireframe,T===Cr?C.side=A.shadowSide!==null?A.shadowSide:A.side:C.side=A.shadowSide!==null?A.shadowSide:d[A.side],C.alphaMap=A.alphaMap,C.alphaTest=A.alphaToCoverage===!0?.5:A.alphaTest,C.map=A.map,C.clipShadows=A.clipShadows,C.clippingPlanes=A.clippingPlanes,C.clipIntersection=A.clipIntersection,C.displacementMap=A.displacementMap,C.displacementScale=A.displacementScale,C.displacementBias=A.displacementBias,C.wireframeLinewidth=A.wireframeLinewidth,C.linewidth=A.linewidth,_.isPointLight===!0&&C.isMeshDistanceMaterial===!0){const D=r.properties.get(C);D.light=_}return C}function v(b,A,_,T,C){if(b.visible===!1)return;if(b.layers.test(A.layers)&&(b.isMesh||b.isLine||b.isPoints)&&(b.castShadow||b.receiveShadow&&C===Cr)&&(!b.frustumCulled||i.intersectsObject(b))){b.modelViewMatrix.multiplyMatrices(_.matrixWorldInverse,b.matrixWorld);const O=t.update(b),H=b.material;if(Array.isArray(H)){const F=O.groups;for(let q=0,G=F.length;q<G;q++){const J=F[q],et=H[J.materialIndex];if(et&&et.visible){const at=E(b,et,T,C);b.onBeforeShadow(r,b,A,_,O,at,J),r.renderBufferDirect(_,null,O,at,b,J),b.onAfterShadow(r,b,A,_,O,at,J)}}}else if(H.visible){const F=E(b,H,T,C);b.onBeforeShadow(r,b,A,_,O,F,null),r.renderBufferDirect(_,null,O,F,b,null),b.onAfterShadow(r,b,A,_,O,F,null)}}const D=b.children;for(let O=0,H=D.length;O<H;O++)v(D[O],A,_,T,C)}function w(b){b.target.removeEventListener("dispose",w);for(const _ in h){const T=h[_],C=b.target.uuid;C in T&&(T[C].dispose(),delete T[C])}}}function _y(r,t){function e(){let I=!1;const ot=new _e;let Q=null;const ut=new _e(0,0,0,0);return{setMask:function(gt){Q!==gt&&!I&&(r.colorMask(gt,gt,gt,gt),Q=gt)},setLocked:function(gt){I=gt},setClear:function(gt,tt,St,vt,fe){fe===!0&&(gt*=vt,tt*=vt,St*=vt),ot.set(gt,tt,St,vt),ut.equals(ot)===!1&&(r.clearColor(gt,tt,St,vt),ut.copy(ot))},reset:function(){I=!1,Q=null,ut.set(-1,0,0,0)}}}function i(){let I=!1,ot=!1,Q=null,ut=null,gt=null;return{setReversed:function(tt){if(ot!==tt){const St=t.get("EXT_clip_control");tt?St.clipControlEXT(St.LOWER_LEFT_EXT,St.ZERO_TO_ONE_EXT):St.clipControlEXT(St.LOWER_LEFT_EXT,St.NEGATIVE_ONE_TO_ONE_EXT),ot=tt;const vt=gt;gt=null,this.setClear(vt)}},getReversed:function(){return ot},setTest:function(tt){tt?it(r.DEPTH_TEST):Dt(r.DEPTH_TEST)},setMask:function(tt){Q!==tt&&!I&&(r.depthMask(tt),Q=tt)},setFunc:function(tt){if(ot&&(tt=Ip[tt]),ut!==tt){switch(tt){case Gl:r.depthFunc(r.NEVER);break;case Hl:r.depthFunc(r.ALWAYS);break;case Wl:r.depthFunc(r.LESS);break;case tr:r.depthFunc(r.LEQUAL);break;case Xl:r.depthFunc(r.EQUAL);break;case ql:r.depthFunc(r.GEQUAL);break;case $l:r.depthFunc(r.GREATER);break;case Yl:r.depthFunc(r.NOTEQUAL);break;default:r.depthFunc(r.LEQUAL)}ut=tt}},setLocked:function(tt){I=tt},setClear:function(tt){gt!==tt&&(gt=tt,ot&&(tt=1-tt),r.clearDepth(tt))},reset:function(){I=!1,Q=null,ut=null,gt=null,ot=!1}}}function n(){let I=!1,ot=null,Q=null,ut=null,gt=null,tt=null,St=null,vt=null,fe=null;return{setTest:function(oe){I||(oe?it(r.STENCIL_TEST):Dt(r.STENCIL_TEST))},setMask:function(oe){ot!==oe&&!I&&(r.stencilMask(oe),ot=oe)},setFunc:function(oe,Di,Ii){(Q!==oe||ut!==Di||gt!==Ii)&&(r.stencilFunc(oe,Di,Ii),Q=oe,ut=Di,gt=Ii)},setOp:function(oe,Di,Ii){(tt!==oe||St!==Di||vt!==Ii)&&(r.stencilOp(oe,Di,Ii),tt=oe,St=Di,vt=Ii)},setLocked:function(oe){I=oe},setClear:function(oe){fe!==oe&&(r.clearStencil(oe),fe=oe)},reset:function(){I=!1,ot=null,Q=null,ut=null,gt=null,tt=null,St=null,vt=null,fe=null}}}const s=new e,a=new i,o=new n,l=new WeakMap,h=new WeakMap;let c={},d={},u={},f=new WeakMap,p=[],x=null,g=!1,m=null,M=null,E=null,v=null,w=null,b=null,A=null,_=new Ft(0,0,0),T=0,C=!1,P=null,D=null,O=null,H=null,F=null;const q=r.getParameter(r.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let G=!1,J=0;const et=r.getParameter(r.VERSION);et.indexOf("WebGL")!==-1?(J=parseFloat(/^WebGL (\d)/.exec(et)[1]),G=J>=1):et.indexOf("OpenGL ES")!==-1&&(J=parseFloat(/^OpenGL ES (\d)/.exec(et)[1]),G=J>=2);let at=null,rt={};const k=r.getParameter(r.SCISSOR_BOX),xt=r.getParameter(r.VIEWPORT),wt=new _e().fromArray(k),Ct=new _e().fromArray(xt);function Y(I,ot,Q,ut){const gt=new Uint8Array(4),tt=r.createTexture();r.bindTexture(I,tt),r.texParameteri(I,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(I,r.TEXTURE_MAG_FILTER,r.NEAREST);for(let St=0;St<Q;St++)I===r.TEXTURE_3D||I===r.TEXTURE_2D_ARRAY?r.texImage3D(ot,0,r.RGBA,1,1,ut,0,r.RGBA,r.UNSIGNED_BYTE,gt):r.texImage2D(ot+St,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,gt);return tt}const nt={};nt[r.TEXTURE_2D]=Y(r.TEXTURE_2D,r.TEXTURE_2D,1),nt[r.TEXTURE_CUBE_MAP]=Y(r.TEXTURE_CUBE_MAP,r.TEXTURE_CUBE_MAP_POSITIVE_X,6),nt[r.TEXTURE_2D_ARRAY]=Y(r.TEXTURE_2D_ARRAY,r.TEXTURE_2D_ARRAY,1,1),nt[r.TEXTURE_3D]=Y(r.TEXTURE_3D,r.TEXTURE_3D,1,1),s.setClear(0,0,0,1),a.setClear(1),o.setClear(0),it(r.DEPTH_TEST),a.setFunc(tr),ye(!1),we(Mc),it(r.CULL_FACE),Xt(sn);function it(I){c[I]!==!0&&(r.enable(I),c[I]=!0)}function Dt(I){c[I]!==!1&&(r.disable(I),c[I]=!1)}function bt(I,ot){return u[I]!==ot?(r.bindFramebuffer(I,ot),u[I]=ot,I===r.DRAW_FRAMEBUFFER&&(u[r.FRAMEBUFFER]=ot),I===r.FRAMEBUFFER&&(u[r.DRAW_FRAMEBUFFER]=ot),!0):!1}function At(I,ot){let Q=p,ut=!1;if(I){Q=f.get(ot),Q===void 0&&(Q=[],f.set(ot,Q));const gt=I.textures;if(Q.length!==gt.length||Q[0]!==r.COLOR_ATTACHMENT0){for(let tt=0,St=gt.length;tt<St;tt++)Q[tt]=r.COLOR_ATTACHMENT0+tt;Q.length=gt.length,ut=!0}}else Q[0]!==r.BACK&&(Q[0]=r.BACK,ut=!0);ut&&r.drawBuffers(Q)}function ce(I){return x!==I?(r.useProgram(I),x=I,!0):!1}const kt={[qn]:r.FUNC_ADD,[ep]:r.FUNC_SUBTRACT,[ip]:r.FUNC_REVERSE_SUBTRACT};kt[np]=r.MIN,kt[sp]=r.MAX;const Qt={[rp]:r.ZERO,[ap]:r.ONE,[op]:r.SRC_COLOR,[Bl]:r.SRC_ALPHA,[fp]:r.SRC_ALPHA_SATURATE,[up]:r.DST_COLOR,[hp]:r.DST_ALPHA,[lp]:r.ONE_MINUS_SRC_COLOR,[Vl]:r.ONE_MINUS_SRC_ALPHA,[dp]:r.ONE_MINUS_DST_COLOR,[cp]:r.ONE_MINUS_DST_ALPHA,[pp]:r.CONSTANT_COLOR,[mp]:r.ONE_MINUS_CONSTANT_COLOR,[gp]:r.CONSTANT_ALPHA,[xp]:r.ONE_MINUS_CONSTANT_ALPHA};function Xt(I,ot,Q,ut,gt,tt,St,vt,fe,oe){if(I===sn){g===!0&&(Dt(r.BLEND),g=!1);return}if(g===!1&&(it(r.BLEND),g=!0),I!==tp){if(I!==m||oe!==C){if((M!==qn||w!==qn)&&(r.blendEquation(r.FUNC_ADD),M=qn,w=qn),oe)switch(I){case $s:r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case bc:r.blendFunc(r.ONE,r.ONE);break;case Sc:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case wc:r.blendFuncSeparate(r.DST_COLOR,r.ONE_MINUS_SRC_ALPHA,r.ZERO,r.ONE);break;default:Zt("WebGLState: Invalid blending: ",I);break}else switch(I){case $s:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case bc:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE,r.ONE,r.ONE);break;case Sc:Zt("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case wc:Zt("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Zt("WebGLState: Invalid blending: ",I);break}E=null,v=null,b=null,A=null,_.set(0,0,0),T=0,m=I,C=oe}return}gt=gt||ot,tt=tt||Q,St=St||ut,(ot!==M||gt!==w)&&(r.blendEquationSeparate(kt[ot],kt[gt]),M=ot,w=gt),(Q!==E||ut!==v||tt!==b||St!==A)&&(r.blendFuncSeparate(Qt[Q],Qt[ut],Qt[tt],Qt[St]),E=Q,v=ut,b=tt,A=St),(vt.equals(_)===!1||fe!==T)&&(r.blendColor(vt.r,vt.g,vt.b,fe),_.copy(vt),T=fe),m=I,C=!1}function Kt(I,ot){I.side===en?Dt(r.CULL_FACE):it(r.CULL_FACE);let Q=I.side===Ue;ot&&(Q=!Q),ye(Q),I.blending===$s&&I.transparent===!1?Xt(sn):Xt(I.blending,I.blendEquation,I.blendSrc,I.blendDst,I.blendEquationAlpha,I.blendSrcAlpha,I.blendDstAlpha,I.blendColor,I.blendAlpha,I.premultipliedAlpha),a.setFunc(I.depthFunc),a.setTest(I.depthTest),a.setMask(I.depthWrite),s.setMask(I.colorWrite);const ut=I.stencilWrite;o.setTest(ut),ut&&(o.setMask(I.stencilWriteMask),o.setFunc(I.stencilFunc,I.stencilRef,I.stencilFuncMask),o.setOp(I.stencilFail,I.stencilZFail,I.stencilZPass)),Ie(I.polygonOffset,I.polygonOffsetFactor,I.polygonOffsetUnits),I.alphaToCoverage===!0?it(r.SAMPLE_ALPHA_TO_COVERAGE):Dt(r.SAMPLE_ALPHA_TO_COVERAGE)}function ye(I){P!==I&&(I?r.frontFace(r.CW):r.frontFace(r.CCW),P=I)}function we(I){I!==Qf?(it(r.CULL_FACE),I!==D&&(I===Mc?r.cullFace(r.BACK):I===jf?r.cullFace(r.FRONT):r.cullFace(r.FRONT_AND_BACK))):Dt(r.CULL_FACE),D=I}function Ce(I){I!==O&&(G&&r.lineWidth(I),O=I)}function Ie(I,ot,Q){I?(it(r.POLYGON_OFFSET_FILL),(H!==ot||F!==Q)&&(H=ot,F=Q,a.getReversed()&&(ot=-ot),r.polygonOffset(ot,Q))):Dt(r.POLYGON_OFFSET_FILL)}function de(I){I?it(r.SCISSOR_TEST):Dt(r.SCISSOR_TEST)}function ve(I){I===void 0&&(I=r.TEXTURE0+q-1),at!==I&&(r.activeTexture(I),at=I)}function L(I,ot,Q){Q===void 0&&(at===null?Q=r.TEXTURE0+q-1:Q=at);let ut=rt[Q];ut===void 0&&(ut={type:void 0,texture:void 0},rt[Q]=ut),(ut.type!==I||ut.texture!==ot)&&(at!==Q&&(r.activeTexture(Q),at=Q),r.bindTexture(I,ot||nt[I]),ut.type=I,ut.texture=ot)}function Ke(){const I=rt[at];I!==void 0&&I.type!==void 0&&(r.bindTexture(I.type,null),I.type=void 0,I.texture=void 0)}function jt(){try{r.compressedTexImage2D(...arguments)}catch(I){Zt("WebGLState:",I)}}function R(){try{r.compressedTexImage3D(...arguments)}catch(I){Zt("WebGLState:",I)}}function y(){try{r.texSubImage2D(...arguments)}catch(I){Zt("WebGLState:",I)}}function z(){try{r.texSubImage3D(...arguments)}catch(I){Zt("WebGLState:",I)}}function W(){try{r.compressedTexSubImage2D(...arguments)}catch(I){Zt("WebGLState:",I)}}function Z(){try{r.compressedTexSubImage3D(...arguments)}catch(I){Zt("WebGLState:",I)}}function st(){try{r.texStorage2D(...arguments)}catch(I){Zt("WebGLState:",I)}}function lt(){try{r.texStorage3D(...arguments)}catch(I){Zt("WebGLState:",I)}}function K(){try{r.texImage2D(...arguments)}catch(I){Zt("WebGLState:",I)}}function j(){try{r.texImage3D(...arguments)}catch(I){Zt("WebGLState:",I)}}function ht(I){return d[I]!==void 0?d[I]:r.getParameter(I)}function Et(I,ot){d[I]!==ot&&(r.pixelStorei(I,ot),d[I]=ot)}function dt(I){wt.equals(I)===!1&&(r.scissor(I.x,I.y,I.z,I.w),wt.copy(I))}function ct(I){Ct.equals(I)===!1&&(r.viewport(I.x,I.y,I.z,I.w),Ct.copy(I))}function Pt(I,ot){let Q=h.get(ot);Q===void 0&&(Q=new WeakMap,h.set(ot,Q));let ut=Q.get(I);ut===void 0&&(ut=r.getUniformBlockIndex(ot,I.name),Q.set(I,ut))}function It(I,ot){const ut=h.get(ot).get(I);l.get(ot)!==ut&&(r.uniformBlockBinding(ot,ut,I.__bindingPointIndex),l.set(ot,ut))}function Ut(){r.disable(r.BLEND),r.disable(r.CULL_FACE),r.disable(r.DEPTH_TEST),r.disable(r.POLYGON_OFFSET_FILL),r.disable(r.SCISSOR_TEST),r.disable(r.STENCIL_TEST),r.disable(r.SAMPLE_ALPHA_TO_COVERAGE),r.blendEquation(r.FUNC_ADD),r.blendFunc(r.ONE,r.ZERO),r.blendFuncSeparate(r.ONE,r.ZERO,r.ONE,r.ZERO),r.blendColor(0,0,0,0),r.colorMask(!0,!0,!0,!0),r.clearColor(0,0,0,0),r.depthMask(!0),r.depthFunc(r.LESS),a.setReversed(!1),r.clearDepth(1),r.stencilMask(4294967295),r.stencilFunc(r.ALWAYS,0,4294967295),r.stencilOp(r.KEEP,r.KEEP,r.KEEP),r.clearStencil(0),r.cullFace(r.BACK),r.frontFace(r.CCW),r.polygonOffset(0,0),r.activeTexture(r.TEXTURE0),r.bindFramebuffer(r.FRAMEBUFFER,null),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),r.bindFramebuffer(r.READ_FRAMEBUFFER,null),r.useProgram(null),r.lineWidth(1),r.scissor(0,0,r.canvas.width,r.canvas.height),r.viewport(0,0,r.canvas.width,r.canvas.height),r.pixelStorei(r.PACK_ALIGNMENT,4),r.pixelStorei(r.UNPACK_ALIGNMENT,4),r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,!1),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,r.BROWSER_DEFAULT_WEBGL),r.pixelStorei(r.PACK_ROW_LENGTH,0),r.pixelStorei(r.PACK_SKIP_PIXELS,0),r.pixelStorei(r.PACK_SKIP_ROWS,0),r.pixelStorei(r.UNPACK_ROW_LENGTH,0),r.pixelStorei(r.UNPACK_IMAGE_HEIGHT,0),r.pixelStorei(r.UNPACK_SKIP_PIXELS,0),r.pixelStorei(r.UNPACK_SKIP_ROWS,0),r.pixelStorei(r.UNPACK_SKIP_IMAGES,0),c={},d={},at=null,rt={},u={},f=new WeakMap,p=[],x=null,g=!1,m=null,M=null,E=null,v=null,w=null,b=null,A=null,_=new Ft(0,0,0),T=0,C=!1,P=null,D=null,O=null,H=null,F=null,wt.set(0,0,r.canvas.width,r.canvas.height),Ct.set(0,0,r.canvas.width,r.canvas.height),s.reset(),a.reset(),o.reset()}return{buffers:{color:s,depth:a,stencil:o},enable:it,disable:Dt,bindFramebuffer:bt,drawBuffers:At,useProgram:ce,setBlending:Xt,setMaterial:Kt,setFlipSided:ye,setCullFace:we,setLineWidth:Ce,setPolygonOffset:Ie,setScissorTest:de,activeTexture:ve,bindTexture:L,unbindTexture:Ke,compressedTexImage2D:jt,compressedTexImage3D:R,texImage2D:K,texImage3D:j,pixelStorei:Et,getParameter:ht,updateUBOMapping:Pt,uniformBlockBinding:It,texStorage2D:st,texStorage3D:lt,texSubImage2D:y,texSubImage3D:z,compressedTexSubImage2D:W,compressedTexSubImage3D:Z,scissor:dt,viewport:ct,reset:Ut}}function yy(r,t,e,i,n,s,a){const o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new Nt,c=new WeakMap,d=new Set;let u;const f=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function x(R,y){return p?new OffscreenCanvas(R,y):uo("canvas")}function g(R,y,z){let W=1;const Z=jt(R);if((Z.width>z||Z.height>z)&&(W=z/Math.max(Z.width,Z.height)),W<1)if(typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&R instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&R instanceof ImageBitmap||typeof VideoFrame<"u"&&R instanceof VideoFrame){const st=Math.floor(W*Z.width),lt=Math.floor(W*Z.height);u===void 0&&(u=x(st,lt));const K=y?x(st,lt):u;return K.width=st,K.height=lt,K.getContext("2d").drawImage(R,0,0,st,lt),Lt("WebGLRenderer: Texture has been resized from ("+Z.width+"x"+Z.height+") to ("+st+"x"+lt+")."),K}else return"data"in R&&Lt("WebGLRenderer: Image in DataTexture is too big ("+Z.width+"x"+Z.height+")."),R;return R}function m(R){return R.generateMipmaps}function M(R){r.generateMipmap(R)}function E(R){return R.isWebGLCubeRenderTarget?r.TEXTURE_CUBE_MAP:R.isWebGL3DRenderTarget?r.TEXTURE_3D:R.isWebGLArrayRenderTarget||R.isCompressedArrayTexture?r.TEXTURE_2D_ARRAY:r.TEXTURE_2D}function v(R,y,z,W,Z,st=!1){if(R!==null){if(r[R]!==void 0)return r[R];Lt("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+R+"'")}let lt;W&&(lt=t.get("EXT_texture_norm16"),lt||Lt("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let K=y;if(y===r.RED&&(z===r.FLOAT&&(K=r.R32F),z===r.HALF_FLOAT&&(K=r.R16F),z===r.UNSIGNED_BYTE&&(K=r.R8),z===r.UNSIGNED_SHORT&&lt&&(K=lt.R16_EXT),z===r.SHORT&&lt&&(K=lt.R16_SNORM_EXT)),y===r.RED_INTEGER&&(z===r.UNSIGNED_BYTE&&(K=r.R8UI),z===r.UNSIGNED_SHORT&&(K=r.R16UI),z===r.UNSIGNED_INT&&(K=r.R32UI),z===r.BYTE&&(K=r.R8I),z===r.SHORT&&(K=r.R16I),z===r.INT&&(K=r.R32I)),y===r.RG&&(z===r.FLOAT&&(K=r.RG32F),z===r.HALF_FLOAT&&(K=r.RG16F),z===r.UNSIGNED_BYTE&&(K=r.RG8),z===r.UNSIGNED_SHORT&&lt&&(K=lt.RG16_EXT),z===r.SHORT&&lt&&(K=lt.RG16_SNORM_EXT)),y===r.RG_INTEGER&&(z===r.UNSIGNED_BYTE&&(K=r.RG8UI),z===r.UNSIGNED_SHORT&&(K=r.RG16UI),z===r.UNSIGNED_INT&&(K=r.RG32UI),z===r.BYTE&&(K=r.RG8I),z===r.SHORT&&(K=r.RG16I),z===r.INT&&(K=r.RG32I)),y===r.RGB_INTEGER&&(z===r.UNSIGNED_BYTE&&(K=r.RGB8UI),z===r.UNSIGNED_SHORT&&(K=r.RGB16UI),z===r.UNSIGNED_INT&&(K=r.RGB32UI),z===r.BYTE&&(K=r.RGB8I),z===r.SHORT&&(K=r.RGB16I),z===r.INT&&(K=r.RGB32I)),y===r.RGBA_INTEGER&&(z===r.UNSIGNED_BYTE&&(K=r.RGBA8UI),z===r.UNSIGNED_SHORT&&(K=r.RGBA16UI),z===r.UNSIGNED_INT&&(K=r.RGBA32UI),z===r.BYTE&&(K=r.RGBA8I),z===r.SHORT&&(K=r.RGBA16I),z===r.INT&&(K=r.RGBA32I)),y===r.RGB&&(z===r.UNSIGNED_SHORT&&lt&&(K=lt.RGB16_EXT),z===r.SHORT&&lt&&(K=lt.RGB16_SNORM_EXT),z===r.UNSIGNED_INT_5_9_9_9_REV&&(K=r.RGB9_E5),z===r.UNSIGNED_INT_10F_11F_11F_REV&&(K=r.R11F_G11F_B10F)),y===r.RGBA){const j=st?co:$t.getTransfer(Z);z===r.FLOAT&&(K=r.RGBA32F),z===r.HALF_FLOAT&&(K=r.RGBA16F),z===r.UNSIGNED_BYTE&&(K=j===te?r.SRGB8_ALPHA8:r.RGBA8),z===r.UNSIGNED_SHORT&&lt&&(K=lt.RGBA16_EXT),z===r.SHORT&&lt&&(K=lt.RGBA16_SNORM_EXT),z===r.UNSIGNED_SHORT_4_4_4_4&&(K=r.RGBA4),z===r.UNSIGNED_SHORT_5_5_5_1&&(K=r.RGB5_A1)}return(K===r.R16F||K===r.R32F||K===r.RG16F||K===r.RG32F||K===r.RGBA16F||K===r.RGBA32F)&&t.get("EXT_color_buffer_float"),K}function w(R,y){let z;return R?y===null||y===Hi||y===Gr?z=r.DEPTH24_STENCIL8:y===wi?z=r.DEPTH32F_STENCIL8:y===Vr&&(z=r.DEPTH24_STENCIL8,Lt("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===Hi||y===Gr?z=r.DEPTH_COMPONENT24:y===wi?z=r.DEPTH_COMPONENT32F:y===Vr&&(z=r.DEPTH_COMPONENT16),z}function b(R,y){return m(R)===!0||R.isFramebufferTexture&&R.minFilter!==Ne&&R.minFilter!==He?Math.log2(Math.max(y.width,y.height))+1:R.mipmaps!==void 0&&R.mipmaps.length>0?R.mipmaps.length:R.isCompressedTexture&&Array.isArray(R.image)?y.mipmaps.length:1}function A(R){const y=R.target;y.removeEventListener("dispose",A),T(y),y.isVideoTexture&&c.delete(y),y.isHTMLTexture&&d.delete(y)}function _(R){const y=R.target;y.removeEventListener("dispose",_),P(y)}function T(R){const y=i.get(R);if(y.__webglInit===void 0)return;const z=R.source,W=f.get(z);if(W){const Z=W[y.__cacheKey];Z.usedTimes--,Z.usedTimes===0&&C(R),Object.keys(W).length===0&&f.delete(z)}i.remove(R)}function C(R){const y=i.get(R);r.deleteTexture(y.__webglTexture);const z=R.source,W=f.get(z);delete W[y.__cacheKey],a.memory.textures--}function P(R){const y=i.get(R);if(R.depthTexture&&(R.depthTexture.dispose(),i.remove(R.depthTexture)),R.isWebGLCubeRenderTarget)for(let W=0;W<6;W++){if(Array.isArray(y.__webglFramebuffer[W]))for(let Z=0;Z<y.__webglFramebuffer[W].length;Z++)r.deleteFramebuffer(y.__webglFramebuffer[W][Z]);else r.deleteFramebuffer(y.__webglFramebuffer[W]);y.__webglDepthbuffer&&r.deleteRenderbuffer(y.__webglDepthbuffer[W])}else{if(Array.isArray(y.__webglFramebuffer))for(let W=0;W<y.__webglFramebuffer.length;W++)r.deleteFramebuffer(y.__webglFramebuffer[W]);else r.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&r.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&r.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let W=0;W<y.__webglColorRenderbuffer.length;W++)y.__webglColorRenderbuffer[W]&&r.deleteRenderbuffer(y.__webglColorRenderbuffer[W]);y.__webglDepthRenderbuffer&&r.deleteRenderbuffer(y.__webglDepthRenderbuffer)}const z=R.textures;for(let W=0,Z=z.length;W<Z;W++){const st=i.get(z[W]);st.__webglTexture&&(r.deleteTexture(st.__webglTexture),a.memory.textures--),i.remove(z[W])}i.remove(R)}let D=0;function O(){D=0}function H(){return D}function F(R){D=R}function q(){const R=D;return R>=n.maxTextures&&Lt("WebGLTextures: Trying to use "+R+" texture units while this GPU supports only "+n.maxTextures),D+=1,R}function G(R){const y=[];return y.push(R.wrapS),y.push(R.wrapT),y.push(R.wrapR||0),y.push(R.magFilter),y.push(R.minFilter),y.push(R.anisotropy),y.push(R.internalFormat),y.push(R.format),y.push(R.type),y.push(R.generateMipmaps),y.push(R.premultiplyAlpha),y.push(R.flipY),y.push(R.unpackAlignment),y.push(R.colorSpace),y.join()}function J(R,y){const z=i.get(R);if(R.isVideoTexture&&L(R),R.isRenderTargetTexture===!1&&R.isExternalTexture!==!0&&R.version>0&&z.__version!==R.version){const W=R.image;if(W===null)Lt("WebGLRenderer: Texture marked for update but no image data found.");else if(W.complete===!1)Lt("WebGLRenderer: Texture marked for update but image is incomplete");else{Dt(z,R,y);return}}else R.isExternalTexture&&(z.__webglTexture=R.sourceTexture?R.sourceTexture:null);e.bindTexture(r.TEXTURE_2D,z.__webglTexture,r.TEXTURE0+y)}function et(R,y){const z=i.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&z.__version!==R.version){Dt(z,R,y);return}else R.isExternalTexture&&(z.__webglTexture=R.sourceTexture?R.sourceTexture:null);e.bindTexture(r.TEXTURE_2D_ARRAY,z.__webglTexture,r.TEXTURE0+y)}function at(R,y){const z=i.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&z.__version!==R.version){Dt(z,R,y);return}e.bindTexture(r.TEXTURE_3D,z.__webglTexture,r.TEXTURE0+y)}function rt(R,y){const z=i.get(R);if(R.isCubeDepthTexture!==!0&&R.version>0&&z.__version!==R.version){bt(z,R,y);return}e.bindTexture(r.TEXTURE_CUBE_MAP,z.__webglTexture,r.TEXTURE0+y)}const k={[Zl]:r.REPEAT,[nn]:r.CLAMP_TO_EDGE,[Kl]:r.MIRRORED_REPEAT},xt={[Ne]:r.NEAREST,[vp]:r.NEAREST_MIPMAP_NEAREST,[Qr]:r.NEAREST_MIPMAP_LINEAR,[He]:r.LINEAR,[Io]:r.LINEAR_MIPMAP_NEAREST,[Yn]:r.LINEAR_MIPMAP_LINEAR},wt={[Sp]:r.NEVER,[Rp]:r.ALWAYS,[wp]:r.LESS,[Jh]:r.LEQUAL,[Ep]:r.EQUAL,[Qh]:r.GEQUAL,[Tp]:r.GREATER,[Ap]:r.NOTEQUAL};function Ct(R,y){if(y.type===wi&&t.has("OES_texture_float_linear")===!1&&(y.magFilter===He||y.magFilter===Io||y.magFilter===Qr||y.magFilter===Yn||y.minFilter===He||y.minFilter===Io||y.minFilter===Qr||y.minFilter===Yn)&&Lt("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),r.texParameteri(R,r.TEXTURE_WRAP_S,k[y.wrapS]),r.texParameteri(R,r.TEXTURE_WRAP_T,k[y.wrapT]),(R===r.TEXTURE_3D||R===r.TEXTURE_2D_ARRAY)&&r.texParameteri(R,r.TEXTURE_WRAP_R,k[y.wrapR]),r.texParameteri(R,r.TEXTURE_MAG_FILTER,xt[y.magFilter]),r.texParameteri(R,r.TEXTURE_MIN_FILTER,xt[y.minFilter]),y.compareFunction&&(r.texParameteri(R,r.TEXTURE_COMPARE_MODE,r.COMPARE_REF_TO_TEXTURE),r.texParameteri(R,r.TEXTURE_COMPARE_FUNC,wt[y.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===Ne||y.minFilter!==Qr&&y.minFilter!==Yn||y.type===wi&&t.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||i.get(y).__currentAnisotropy){const z=t.get("EXT_texture_filter_anisotropic");r.texParameterf(R,z.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,n.getMaxAnisotropy())),i.get(y).__currentAnisotropy=y.anisotropy}}}function Y(R,y){let z=!1;R.__webglInit===void 0&&(R.__webglInit=!0,y.addEventListener("dispose",A));const W=y.source;let Z=f.get(W);Z===void 0&&(Z={},f.set(W,Z));const st=G(y);if(st!==R.__cacheKey){Z[st]===void 0&&(Z[st]={texture:r.createTexture(),usedTimes:0},a.memory.textures++,z=!0),Z[st].usedTimes++;const lt=Z[R.__cacheKey];lt!==void 0&&(Z[R.__cacheKey].usedTimes--,lt.usedTimes===0&&C(y)),R.__cacheKey=st,R.__webglTexture=Z[st].texture}return z}function nt(R,y,z){return Math.floor(Math.floor(R/z)/y)}function it(R,y,z,W){const st=R.updateRanges;if(st.length===0)e.texSubImage2D(r.TEXTURE_2D,0,0,0,y.width,y.height,z,W,y.data);else{st.sort((Et,dt)=>Et.start-dt.start);let lt=0;for(let Et=1;Et<st.length;Et++){const dt=st[lt],ct=st[Et],Pt=dt.start+dt.count,It=nt(ct.start,y.width,4),Ut=nt(dt.start,y.width,4);ct.start<=Pt+1&&It===Ut&&nt(ct.start+ct.count-1,y.width,4)===It?dt.count=Math.max(dt.count,ct.start+ct.count-dt.start):(++lt,st[lt]=ct)}st.length=lt+1;const K=e.getParameter(r.UNPACK_ROW_LENGTH),j=e.getParameter(r.UNPACK_SKIP_PIXELS),ht=e.getParameter(r.UNPACK_SKIP_ROWS);e.pixelStorei(r.UNPACK_ROW_LENGTH,y.width);for(let Et=0,dt=st.length;Et<dt;Et++){const ct=st[Et],Pt=Math.floor(ct.start/4),It=Math.ceil(ct.count/4),Ut=Pt%y.width,I=Math.floor(Pt/y.width),ot=It,Q=1;e.pixelStorei(r.UNPACK_SKIP_PIXELS,Ut),e.pixelStorei(r.UNPACK_SKIP_ROWS,I),e.texSubImage2D(r.TEXTURE_2D,0,Ut,I,ot,Q,z,W,y.data)}R.clearUpdateRanges(),e.pixelStorei(r.UNPACK_ROW_LENGTH,K),e.pixelStorei(r.UNPACK_SKIP_PIXELS,j),e.pixelStorei(r.UNPACK_SKIP_ROWS,ht)}}function Dt(R,y,z){let W=r.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(W=r.TEXTURE_2D_ARRAY),y.isData3DTexture&&(W=r.TEXTURE_3D);const Z=Y(R,y),st=y.source;e.bindTexture(W,R.__webglTexture,r.TEXTURE0+z);const lt=i.get(st);if(st.version!==lt.__version||Z===!0){if(e.activeTexture(r.TEXTURE0+z),(typeof ImageBitmap<"u"&&y.image instanceof ImageBitmap)===!1){const Q=$t.getPrimaries($t.workingColorSpace),ut=y.colorSpace===Tn?null:$t.getPrimaries(y.colorSpace),gt=y.colorSpace===Tn||Q===ut?r.NONE:r.BROWSER_DEFAULT_WEBGL;e.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,y.flipY),e.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),e.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,gt)}e.pixelStorei(r.UNPACK_ALIGNMENT,y.unpackAlignment);let j=g(y.image,!1,n.maxTextureSize);j=Ke(y,j);const ht=s.convert(y.format,y.colorSpace),Et=s.convert(y.type);let dt=v(y.internalFormat,ht,Et,y.normalized,y.colorSpace,y.isVideoTexture);Ct(W,y);let ct;const Pt=y.mipmaps,It=y.isVideoTexture!==!0,Ut=lt.__version===void 0||Z===!0,I=st.dataReady,ot=b(y,j);if(y.isDepthTexture)dt=w(y.format===Zn,y.type),Ut&&(It?e.texStorage2D(r.TEXTURE_2D,1,dt,j.width,j.height):e.texImage2D(r.TEXTURE_2D,0,dt,j.width,j.height,0,ht,Et,null));else if(y.isDataTexture)if(Pt.length>0){It&&Ut&&e.texStorage2D(r.TEXTURE_2D,ot,dt,Pt[0].width,Pt[0].height);for(let Q=0,ut=Pt.length;Q<ut;Q++)ct=Pt[Q],It?I&&e.texSubImage2D(r.TEXTURE_2D,Q,0,0,ct.width,ct.height,ht,Et,ct.data):e.texImage2D(r.TEXTURE_2D,Q,dt,ct.width,ct.height,0,ht,Et,ct.data);y.generateMipmaps=!1}else It?(Ut&&e.texStorage2D(r.TEXTURE_2D,ot,dt,j.width,j.height),I&&it(y,j,ht,Et)):e.texImage2D(r.TEXTURE_2D,0,dt,j.width,j.height,0,ht,Et,j.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){It&&Ut&&e.texStorage3D(r.TEXTURE_2D_ARRAY,ot,dt,Pt[0].width,Pt[0].height,j.depth);for(let Q=0,ut=Pt.length;Q<ut;Q++)if(ct=Pt[Q],y.format!==Ei)if(ht!==null)if(It){if(I)if(y.layerUpdates.size>0){const gt=nu(ct.width,ct.height,y.format,y.type);for(const tt of y.layerUpdates){const St=ct.data.subarray(tt*gt/ct.data.BYTES_PER_ELEMENT,(tt+1)*gt/ct.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,Q,0,0,tt,ct.width,ct.height,1,ht,St)}y.clearLayerUpdates()}else e.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,Q,0,0,0,ct.width,ct.height,j.depth,ht,ct.data)}else e.compressedTexImage3D(r.TEXTURE_2D_ARRAY,Q,dt,ct.width,ct.height,j.depth,0,ct.data,0,0);else Lt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else It?I&&e.texSubImage3D(r.TEXTURE_2D_ARRAY,Q,0,0,0,ct.width,ct.height,j.depth,ht,Et,ct.data):e.texImage3D(r.TEXTURE_2D_ARRAY,Q,dt,ct.width,ct.height,j.depth,0,ht,Et,ct.data)}else{It&&Ut&&e.texStorage2D(r.TEXTURE_2D,ot,dt,Pt[0].width,Pt[0].height);for(let Q=0,ut=Pt.length;Q<ut;Q++)ct=Pt[Q],y.format!==Ei?ht!==null?It?I&&e.compressedTexSubImage2D(r.TEXTURE_2D,Q,0,0,ct.width,ct.height,ht,ct.data):e.compressedTexImage2D(r.TEXTURE_2D,Q,dt,ct.width,ct.height,0,ct.data):Lt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):It?I&&e.texSubImage2D(r.TEXTURE_2D,Q,0,0,ct.width,ct.height,ht,Et,ct.data):e.texImage2D(r.TEXTURE_2D,Q,dt,ct.width,ct.height,0,ht,Et,ct.data)}else if(y.isDataArrayTexture)if(It){if(Ut&&e.texStorage3D(r.TEXTURE_2D_ARRAY,ot,dt,j.width,j.height,j.depth),I)if(y.layerUpdates.size>0){const Q=nu(j.width,j.height,y.format,y.type);for(const ut of y.layerUpdates){const gt=j.data.subarray(ut*Q/j.data.BYTES_PER_ELEMENT,(ut+1)*Q/j.data.BYTES_PER_ELEMENT);e.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,ut,j.width,j.height,1,ht,Et,gt)}y.clearLayerUpdates()}else e.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,0,j.width,j.height,j.depth,ht,Et,j.data)}else e.texImage3D(r.TEXTURE_2D_ARRAY,0,dt,j.width,j.height,j.depth,0,ht,Et,j.data);else if(y.isData3DTexture)It?(Ut&&e.texStorage3D(r.TEXTURE_3D,ot,dt,j.width,j.height,j.depth),I&&e.texSubImage3D(r.TEXTURE_3D,0,0,0,0,j.width,j.height,j.depth,ht,Et,j.data)):e.texImage3D(r.TEXTURE_3D,0,dt,j.width,j.height,j.depth,0,ht,Et,j.data);else if(y.isFramebufferTexture){if(Ut)if(It)e.texStorage2D(r.TEXTURE_2D,ot,dt,j.width,j.height);else{let Q=j.width,ut=j.height;for(let gt=0;gt<ot;gt++)e.texImage2D(r.TEXTURE_2D,gt,dt,Q,ut,0,ht,Et,null),Q>>=1,ut>>=1}}else if(y.isHTMLTexture){if("texElementImage2D"in r){const Q=r.canvas;if(Q.hasAttribute("layoutsubtree")||Q.setAttribute("layoutsubtree","true"),j.parentNode!==Q){Q.appendChild(j),d.add(y),Q.onpaint=ut=>{const gt=ut.changedElements;for(const tt of d)gt.includes(tt.image)&&(tt.needsUpdate=!0)},Q.requestPaint();return}if(r.texElementImage2D.length===3)r.texElementImage2D(r.TEXTURE_2D,r.RGBA8,j);else{const gt=r.RGBA,tt=r.RGBA,St=r.UNSIGNED_BYTE;r.texElementImage2D(r.TEXTURE_2D,0,gt,tt,St,j)}r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE)}}else if(Pt.length>0){if(It&&Ut){const Q=jt(Pt[0]);e.texStorage2D(r.TEXTURE_2D,ot,dt,Q.width,Q.height)}for(let Q=0,ut=Pt.length;Q<ut;Q++)ct=Pt[Q],It?I&&e.texSubImage2D(r.TEXTURE_2D,Q,0,0,ht,Et,ct):e.texImage2D(r.TEXTURE_2D,Q,dt,ht,Et,ct);y.generateMipmaps=!1}else if(It){if(Ut){const Q=jt(j);e.texStorage2D(r.TEXTURE_2D,ot,dt,Q.width,Q.height)}I&&e.texSubImage2D(r.TEXTURE_2D,0,0,0,ht,Et,j)}else e.texImage2D(r.TEXTURE_2D,0,dt,ht,Et,j);m(y)&&M(W),lt.__version=st.version,y.onUpdate&&y.onUpdate(y)}R.__version=y.version}function bt(R,y,z){if(y.image.length!==6)return;const W=Y(R,y),Z=y.source;e.bindTexture(r.TEXTURE_CUBE_MAP,R.__webglTexture,r.TEXTURE0+z);const st=i.get(Z);if(Z.version!==st.__version||W===!0){e.activeTexture(r.TEXTURE0+z);const lt=$t.getPrimaries($t.workingColorSpace),K=y.colorSpace===Tn?null:$t.getPrimaries(y.colorSpace),j=y.colorSpace===Tn||lt===K?r.NONE:r.BROWSER_DEFAULT_WEBGL;e.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,y.flipY),e.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),e.pixelStorei(r.UNPACK_ALIGNMENT,y.unpackAlignment),e.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,j);const ht=y.isCompressedTexture||y.image[0].isCompressedTexture,Et=y.image[0]&&y.image[0].isDataTexture,dt=[];for(let tt=0;tt<6;tt++)!ht&&!Et?dt[tt]=g(y.image[tt],!0,n.maxCubemapSize):dt[tt]=Et?y.image[tt].image:y.image[tt],dt[tt]=Ke(y,dt[tt]);const ct=dt[0],Pt=s.convert(y.format,y.colorSpace),It=s.convert(y.type),Ut=v(y.internalFormat,Pt,It,y.normalized,y.colorSpace),I=y.isVideoTexture!==!0,ot=st.__version===void 0||W===!0,Q=Z.dataReady;let ut=b(y,ct);Ct(r.TEXTURE_CUBE_MAP,y);let gt;if(ht){I&&ot&&e.texStorage2D(r.TEXTURE_CUBE_MAP,ut,Ut,ct.width,ct.height);for(let tt=0;tt<6;tt++){gt=dt[tt].mipmaps;for(let St=0;St<gt.length;St++){const vt=gt[St];y.format!==Ei?Pt!==null?I?Q&&e.compressedTexSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St,0,0,vt.width,vt.height,Pt,vt.data):e.compressedTexImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St,Ut,vt.width,vt.height,0,vt.data):Lt("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):I?Q&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St,0,0,vt.width,vt.height,Pt,It,vt.data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St,Ut,vt.width,vt.height,0,Pt,It,vt.data)}}}else{if(gt=y.mipmaps,I&&ot){gt.length>0&&ut++;const tt=jt(dt[0]);e.texStorage2D(r.TEXTURE_CUBE_MAP,ut,Ut,tt.width,tt.height)}for(let tt=0;tt<6;tt++)if(Et){I?Q&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,0,0,0,dt[tt].width,dt[tt].height,Pt,It,dt[tt].data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,0,Ut,dt[tt].width,dt[tt].height,0,Pt,It,dt[tt].data);for(let St=0;St<gt.length;St++){const fe=gt[St].image[tt].image;I?Q&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St+1,0,0,fe.width,fe.height,Pt,It,fe.data):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St+1,Ut,fe.width,fe.height,0,Pt,It,fe.data)}}else{I?Q&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,0,0,0,Pt,It,dt[tt]):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,0,Ut,Pt,It,dt[tt]);for(let St=0;St<gt.length;St++){const vt=gt[St];I?Q&&e.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St+1,0,0,Pt,It,vt.image[tt]):e.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+tt,St+1,Ut,Pt,It,vt.image[tt])}}}m(y)&&M(r.TEXTURE_CUBE_MAP),st.__version=Z.version,y.onUpdate&&y.onUpdate(y)}R.__version=y.version}function At(R,y,z,W,Z,st){const lt=s.convert(z.format,z.colorSpace),K=s.convert(z.type),j=v(z.internalFormat,lt,K,z.normalized,z.colorSpace),ht=i.get(y),Et=i.get(z);if(Et.__renderTarget=y,!ht.__hasExternalTextures){const dt=Math.max(1,y.width>>st),ct=Math.max(1,y.height>>st);Z===r.TEXTURE_3D||Z===r.TEXTURE_2D_ARRAY?e.texImage3D(Z,st,j,dt,ct,y.depth,0,lt,K,null):e.texImage2D(Z,st,j,dt,ct,0,lt,K,null)}e.bindFramebuffer(r.FRAMEBUFFER,R),ve(y)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,W,Z,Et.__webglTexture,0,de(y)):(Z===r.TEXTURE_2D||Z>=r.TEXTURE_CUBE_MAP_POSITIVE_X&&Z<=r.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&r.framebufferTexture2D(r.FRAMEBUFFER,W,Z,Et.__webglTexture,st),e.bindFramebuffer(r.FRAMEBUFFER,null)}function ce(R,y,z){if(r.bindRenderbuffer(r.RENDERBUFFER,R),y.depthBuffer){const W=y.depthTexture,Z=W&&W.isDepthTexture?W.type:null,st=w(y.stencilBuffer,Z),lt=y.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;ve(y)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,de(y),st,y.width,y.height):z?r.renderbufferStorageMultisample(r.RENDERBUFFER,de(y),st,y.width,y.height):r.renderbufferStorage(r.RENDERBUFFER,st,y.width,y.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,lt,r.RENDERBUFFER,R)}else{const W=y.textures;for(let Z=0;Z<W.length;Z++){const st=W[Z],lt=s.convert(st.format,st.colorSpace),K=s.convert(st.type),j=v(st.internalFormat,lt,K,st.normalized,st.colorSpace);ve(y)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,de(y),j,y.width,y.height):z?r.renderbufferStorageMultisample(r.RENDERBUFFER,de(y),j,y.width,y.height):r.renderbufferStorage(r.RENDERBUFFER,j,y.width,y.height)}}r.bindRenderbuffer(r.RENDERBUFFER,null)}function kt(R,y,z){const W=y.isWebGLCubeRenderTarget===!0;if(e.bindFramebuffer(r.FRAMEBUFFER,R),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");const Z=i.get(y.depthTexture);if(Z.__renderTarget=y,(!Z.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),W){if(Z.__webglInit===void 0&&(Z.__webglInit=!0,y.depthTexture.addEventListener("dispose",A)),Z.__webglTexture===void 0){Z.__webglTexture=r.createTexture(),e.bindTexture(r.TEXTURE_CUBE_MAP,Z.__webglTexture),Ct(r.TEXTURE_CUBE_MAP,y.depthTexture);const ht=s.convert(y.depthTexture.format),Et=s.convert(y.depthTexture.type);let dt;y.depthTexture.format===hn?dt=r.DEPTH_COMPONENT24:y.depthTexture.format===Zn&&(dt=r.DEPTH24_STENCIL8);for(let ct=0;ct<6;ct++)r.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+ct,0,dt,y.width,y.height,0,ht,Et,null)}}else J(y.depthTexture,0);const st=Z.__webglTexture,lt=de(y),K=W?r.TEXTURE_CUBE_MAP_POSITIVE_X+z:r.TEXTURE_2D,j=y.depthTexture.format===Zn?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;if(y.depthTexture.format===hn)ve(y)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,j,K,st,0,lt):r.framebufferTexture2D(r.FRAMEBUFFER,j,K,st,0);else if(y.depthTexture.format===Zn)ve(y)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,j,K,st,0,lt):r.framebufferTexture2D(r.FRAMEBUFFER,j,K,st,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function Qt(R){const y=i.get(R),z=R.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==R.depthTexture){const W=R.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),W){const Z=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,W.removeEventListener("dispose",Z)};W.addEventListener("dispose",Z),y.__depthDisposeCallback=Z}y.__boundDepthTexture=W}if(R.depthTexture&&!y.__autoAllocateDepthBuffer)if(z)for(let W=0;W<6;W++)kt(y.__webglFramebuffer[W],R,W);else{const W=R.texture.mipmaps;W&&W.length>0?kt(y.__webglFramebuffer[0],R,0):kt(y.__webglFramebuffer,R,0)}else if(z){y.__webglDepthbuffer=[];for(let W=0;W<6;W++)if(e.bindFramebuffer(r.FRAMEBUFFER,y.__webglFramebuffer[W]),y.__webglDepthbuffer[W]===void 0)y.__webglDepthbuffer[W]=r.createRenderbuffer(),ce(y.__webglDepthbuffer[W],R,!1);else{const Z=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,st=y.__webglDepthbuffer[W];r.bindRenderbuffer(r.RENDERBUFFER,st),r.framebufferRenderbuffer(r.FRAMEBUFFER,Z,r.RENDERBUFFER,st)}}else{const W=R.texture.mipmaps;if(W&&W.length>0?e.bindFramebuffer(r.FRAMEBUFFER,y.__webglFramebuffer[0]):e.bindFramebuffer(r.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=r.createRenderbuffer(),ce(y.__webglDepthbuffer,R,!1);else{const Z=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,st=y.__webglDepthbuffer;r.bindRenderbuffer(r.RENDERBUFFER,st),r.framebufferRenderbuffer(r.FRAMEBUFFER,Z,r.RENDERBUFFER,st)}}e.bindFramebuffer(r.FRAMEBUFFER,null)}function Xt(R,y,z){const W=i.get(R);y!==void 0&&At(W.__webglFramebuffer,R,R.texture,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,0),z!==void 0&&Qt(R)}function Kt(R){const y=R.texture,z=i.get(R),W=i.get(y);R.addEventListener("dispose",_);const Z=R.textures,st=R.isWebGLCubeRenderTarget===!0,lt=Z.length>1;if(lt||(W.__webglTexture===void 0&&(W.__webglTexture=r.createTexture()),W.__version=y.version,a.memory.textures++),st){z.__webglFramebuffer=[];for(let K=0;K<6;K++)if(y.mipmaps&&y.mipmaps.length>0){z.__webglFramebuffer[K]=[];for(let j=0;j<y.mipmaps.length;j++)z.__webglFramebuffer[K][j]=r.createFramebuffer()}else z.__webglFramebuffer[K]=r.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){z.__webglFramebuffer=[];for(let K=0;K<y.mipmaps.length;K++)z.__webglFramebuffer[K]=r.createFramebuffer()}else z.__webglFramebuffer=r.createFramebuffer();if(lt)for(let K=0,j=Z.length;K<j;K++){const ht=i.get(Z[K]);ht.__webglTexture===void 0&&(ht.__webglTexture=r.createTexture(),a.memory.textures++)}if(R.samples>0&&ve(R)===!1){z.__webglMultisampledFramebuffer=r.createFramebuffer(),z.__webglColorRenderbuffer=[],e.bindFramebuffer(r.FRAMEBUFFER,z.__webglMultisampledFramebuffer);for(let K=0;K<Z.length;K++){const j=Z[K];z.__webglColorRenderbuffer[K]=r.createRenderbuffer(),r.bindRenderbuffer(r.RENDERBUFFER,z.__webglColorRenderbuffer[K]);const ht=s.convert(j.format,j.colorSpace),Et=s.convert(j.type),dt=v(j.internalFormat,ht,Et,j.normalized,j.colorSpace,R.isXRRenderTarget===!0),ct=de(R);r.renderbufferStorageMultisample(r.RENDERBUFFER,ct,dt,R.width,R.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+K,r.RENDERBUFFER,z.__webglColorRenderbuffer[K])}r.bindRenderbuffer(r.RENDERBUFFER,null),R.depthBuffer&&(z.__webglDepthRenderbuffer=r.createRenderbuffer(),ce(z.__webglDepthRenderbuffer,R,!0)),e.bindFramebuffer(r.FRAMEBUFFER,null)}}if(st){e.bindTexture(r.TEXTURE_CUBE_MAP,W.__webglTexture),Ct(r.TEXTURE_CUBE_MAP,y);for(let K=0;K<6;K++)if(y.mipmaps&&y.mipmaps.length>0)for(let j=0;j<y.mipmaps.length;j++)At(z.__webglFramebuffer[K][j],R,y,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+K,j);else At(z.__webglFramebuffer[K],R,y,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+K,0);m(y)&&M(r.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(lt){for(let K=0,j=Z.length;K<j;K++){const ht=Z[K],Et=i.get(ht);let dt=r.TEXTURE_2D;(R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(dt=R.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),e.bindTexture(dt,Et.__webglTexture),Ct(dt,ht),At(z.__webglFramebuffer,R,ht,r.COLOR_ATTACHMENT0+K,dt,0),m(ht)&&M(dt)}e.unbindTexture()}else{let K=r.TEXTURE_2D;if((R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(K=R.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),e.bindTexture(K,W.__webglTexture),Ct(K,y),y.mipmaps&&y.mipmaps.length>0)for(let j=0;j<y.mipmaps.length;j++)At(z.__webglFramebuffer[j],R,y,r.COLOR_ATTACHMENT0,K,j);else At(z.__webglFramebuffer,R,y,r.COLOR_ATTACHMENT0,K,0);m(y)&&M(K),e.unbindTexture()}R.depthBuffer&&Qt(R)}function ye(R){const y=R.textures;for(let z=0,W=y.length;z<W;z++){const Z=y[z];if(m(Z)){const st=E(R),lt=i.get(Z).__webglTexture;e.bindTexture(st,lt),M(st),e.unbindTexture()}}}const we=[],Ce=[];function Ie(R){if(R.samples>0){if(ve(R)===!1){const y=R.textures,z=R.width,W=R.height;let Z=r.COLOR_BUFFER_BIT;const st=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,lt=i.get(R),K=y.length>1;if(K)for(let ht=0;ht<y.length;ht++)e.bindFramebuffer(r.FRAMEBUFFER,lt.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+ht,r.RENDERBUFFER,null),e.bindFramebuffer(r.FRAMEBUFFER,lt.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+ht,r.TEXTURE_2D,null,0);e.bindFramebuffer(r.READ_FRAMEBUFFER,lt.__webglMultisampledFramebuffer);const j=R.texture.mipmaps;j&&j.length>0?e.bindFramebuffer(r.DRAW_FRAMEBUFFER,lt.__webglFramebuffer[0]):e.bindFramebuffer(r.DRAW_FRAMEBUFFER,lt.__webglFramebuffer);for(let ht=0;ht<y.length;ht++){if(R.resolveDepthBuffer&&(R.depthBuffer&&(Z|=r.DEPTH_BUFFER_BIT),R.stencilBuffer&&R.resolveStencilBuffer&&(Z|=r.STENCIL_BUFFER_BIT)),K){r.framebufferRenderbuffer(r.READ_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.RENDERBUFFER,lt.__webglColorRenderbuffer[ht]);const Et=i.get(y[ht]).__webglTexture;r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,Et,0)}r.blitFramebuffer(0,0,z,W,0,0,z,W,Z,r.NEAREST),l===!0&&(we.length=0,Ce.length=0,we.push(r.COLOR_ATTACHMENT0+ht),R.depthBuffer&&R.resolveDepthBuffer===!1&&(we.push(st),Ce.push(st),r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,Ce)),r.invalidateFramebuffer(r.READ_FRAMEBUFFER,we))}if(e.bindFramebuffer(r.READ_FRAMEBUFFER,null),e.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),K)for(let ht=0;ht<y.length;ht++){e.bindFramebuffer(r.FRAMEBUFFER,lt.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+ht,r.RENDERBUFFER,lt.__webglColorRenderbuffer[ht]);const Et=i.get(y[ht]).__webglTexture;e.bindFramebuffer(r.FRAMEBUFFER,lt.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+ht,r.TEXTURE_2D,Et,0)}e.bindFramebuffer(r.DRAW_FRAMEBUFFER,lt.__webglMultisampledFramebuffer)}else if(R.depthBuffer&&R.resolveDepthBuffer===!1&&l){const y=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,[y])}}}function de(R){return Math.min(n.maxSamples,R.samples)}function ve(R){const y=i.get(R);return R.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function L(R){const y=a.render.frame;c.get(R)!==y&&(c.set(R,y),R.update())}function Ke(R,y){const z=R.colorSpace,W=R.format,Z=R.type;return R.isCompressedTexture===!0||R.isVideoTexture===!0||z!==ho&&z!==Tn&&($t.getTransfer(z)===te?(W!==Ei||Z!==ai)&&Lt("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Zt("WebGLTextures: Unsupported texture color space:",z)),y}function jt(R){return typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement?(h.width=R.naturalWidth||R.width,h.height=R.naturalHeight||R.height):typeof VideoFrame<"u"&&R instanceof VideoFrame?(h.width=R.displayWidth,h.height=R.displayHeight):(h.width=R.width,h.height=R.height),h}this.allocateTextureUnit=q,this.resetTextureUnits=O,this.getTextureUnits=H,this.setTextureUnits=F,this.setTexture2D=J,this.setTexture2DArray=et,this.setTexture3D=at,this.setTextureCube=rt,this.rebindTextures=Xt,this.setupRenderTarget=Kt,this.updateRenderTargetMipmap=ye,this.updateMultisampleRenderTarget=Ie,this.setupDepthRenderbuffer=Qt,this.setupFrameBufferTexture=At,this.useMultisampledRTT=ve,this.isReversedDepthBuffer=function(){return e.buffers.depth.getReversed()}}function vy(r,t){function e(i,n=Tn){let s;const a=$t.getTransfer(n);if(i===ai)return r.UNSIGNED_BYTE;if(i===Xh)return r.UNSIGNED_SHORT_4_4_4_4;if(i===qh)return r.UNSIGNED_SHORT_5_5_5_1;if(i===kd)return r.UNSIGNED_INT_5_9_9_9_REV;if(i===Bd)return r.UNSIGNED_INT_10F_11F_11F_REV;if(i===zd)return r.BYTE;if(i===Od)return r.SHORT;if(i===Vr)return r.UNSIGNED_SHORT;if(i===Wh)return r.INT;if(i===Hi)return r.UNSIGNED_INT;if(i===wi)return r.FLOAT;if(i===ln)return r.HALF_FLOAT;if(i===Vd)return r.ALPHA;if(i===Gd)return r.RGB;if(i===Ei)return r.RGBA;if(i===hn)return r.DEPTH_COMPONENT;if(i===Zn)return r.DEPTH_STENCIL;if(i===$h)return r.RED;if(i===Yh)return r.RED_INTEGER;if(i===Jn)return r.RG;if(i===Zh)return r.RG_INTEGER;if(i===Kh)return r.RGBA_INTEGER;if(i===Ka||i===Ja||i===Qa||i===ja)if(a===te)if(s=t.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===Ka)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Ja)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Qa)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===ja)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=t.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===Ka)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Ja)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Qa)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===ja)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Jl||i===Ql||i===jl||i===th)if(s=t.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Jl)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===Ql)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===jl)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===th)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===eh||i===ih||i===nh||i===sh||i===rh||i===ao||i===ah)if(s=t.get("WEBGL_compressed_texture_etc"),s!==null){if(i===eh||i===ih)return a===te?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===nh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===sh)return s.COMPRESSED_R11_EAC;if(i===rh)return s.COMPRESSED_SIGNED_R11_EAC;if(i===ao)return s.COMPRESSED_RG11_EAC;if(i===ah)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===oh||i===lh||i===hh||i===ch||i===uh||i===dh||i===fh||i===ph||i===mh||i===gh||i===xh||i===_h||i===yh||i===vh)if(s=t.get("WEBGL_compressed_texture_astc"),s!==null){if(i===oh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===lh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===hh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===ch)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===uh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===dh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===fh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===ph)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===mh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===gh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===xh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===_h)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===yh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===vh)return a===te?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===Mh||i===bh||i===Sh)if(s=t.get("EXT_texture_compression_bptc"),s!==null){if(i===Mh)return a===te?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===bh)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===Sh)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===wh||i===Eh||i===oo||i===Th)if(s=t.get("EXT_texture_compression_rgtc"),s!==null){if(i===wh)return s.COMPRESSED_RED_RGTC1_EXT;if(i===Eh)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===oo)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Th)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Gr?r.UNSIGNED_INT_24_8:r[i]!==void 0?r[i]:null}return{convert:e}}const My=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,by=`
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

}`;class Sy{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){const i=new sf(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,i=new gi({vertexShader:My,fragmentShader:by,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Se(new rf(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class wy extends Nn{constructor(t,e){super();const i=this;let n=null,s=1,a=null,o="local-floor",l=1,h=null,c=null,d=null,u=null,f=null,p=null;const x=typeof XRWebGLBinding<"u",g=new Sy,m={},M=e.getContextAttributes();let E=null,v=null;const w=[],b=[],A=new Nt;let _=null;const T=new ri;T.viewport=new _e;const C=new ri;C.viewport=new _e;const P=[T,C],D=new Im;let O=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Y){let nt=w[Y];return nt===void 0&&(nt=new Oo,w[Y]=nt),nt.getTargetRaySpace()},this.getControllerGrip=function(Y){let nt=w[Y];return nt===void 0&&(nt=new Oo,w[Y]=nt),nt.getGripSpace()},this.getHand=function(Y){let nt=w[Y];return nt===void 0&&(nt=new Oo,w[Y]=nt),nt.getHandSpace()};function F(Y){const nt=b.indexOf(Y.inputSource);if(nt===-1)return;const it=w[nt];it!==void 0&&(it.update(Y.inputSource,Y.frame,h||a),it.dispatchEvent({type:Y.type,data:Y.inputSource}))}function q(){n.removeEventListener("select",F),n.removeEventListener("selectstart",F),n.removeEventListener("selectend",F),n.removeEventListener("squeeze",F),n.removeEventListener("squeezestart",F),n.removeEventListener("squeezeend",F),n.removeEventListener("end",q),n.removeEventListener("inputsourceschange",G);for(let Y=0;Y<w.length;Y++){const nt=b[Y];nt!==null&&(b[Y]=null,w[Y].disconnect(nt))}O=null,H=null,g.reset();for(const Y in m)delete m[Y];t.setRenderTarget(E),f=null,u=null,d=null,n=null,v=null,Ct.stop(),i.isPresenting=!1,t.setPixelRatio(_),t.setSize(A.width,A.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Y){s=Y,i.isPresenting===!0&&Lt("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Y){o=Y,i.isPresenting===!0&&Lt("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return h||a},this.setReferenceSpace=function(Y){h=Y},this.getBaseLayer=function(){return u!==null?u:f},this.getBinding=function(){return d===null&&x&&(d=new XRWebGLBinding(n,e)),d},this.getFrame=function(){return p},this.getSession=function(){return n},this.setSession=async function(Y){if(n=Y,n!==null){if(E=t.getRenderTarget(),n.addEventListener("select",F),n.addEventListener("selectstart",F),n.addEventListener("selectend",F),n.addEventListener("squeeze",F),n.addEventListener("squeezestart",F),n.addEventListener("squeezeend",F),n.addEventListener("end",q),n.addEventListener("inputsourceschange",G),M.xrCompatible!==!0&&await e.makeXRCompatible(),_=t.getPixelRatio(),t.getSize(A),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let it=null,Dt=null,bt=null;M.depth&&(bt=M.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,it=M.stencil?Zn:hn,Dt=M.stencil?Gr:Hi);const At={colorFormat:e.RGBA8,depthFormat:bt,scaleFactor:s};d=this.getBinding(),u=d.createProjectionLayer(At),n.updateRenderState({layers:[u]}),t.setPixelRatio(1),t.setSize(u.textureWidth,u.textureHeight,!1),v=new Gi(u.textureWidth,u.textureHeight,{format:Ei,type:ai,depthTexture:new ir(u.textureWidth,u.textureHeight,Dt,void 0,void 0,void 0,void 0,void 0,void 0,it),stencilBuffer:M.stencil,colorSpace:t.outputColorSpace,samples:M.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1})}else{const it={antialias:M.antialias,alpha:!0,depth:M.depth,stencil:M.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(n,e,it),n.updateRenderState({baseLayer:f}),t.setPixelRatio(1),t.setSize(f.framebufferWidth,f.framebufferHeight,!1),v=new Gi(f.framebufferWidth,f.framebufferHeight,{format:Ei,type:ai,colorSpace:t.outputColorSpace,stencilBuffer:M.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}v.isXRRenderTarget=!0,this.setFoveation(l),h=null,a=await n.requestReferenceSpace(o),Ct.setContext(n),Ct.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(n!==null)return n.environmentBlendMode},this.getDepthTexture=function(){return g.getDepthTexture()};function G(Y){for(let nt=0;nt<Y.removed.length;nt++){const it=Y.removed[nt],Dt=b.indexOf(it);Dt>=0&&(b[Dt]=null,w[Dt].disconnect(it))}for(let nt=0;nt<Y.added.length;nt++){const it=Y.added[nt];let Dt=b.indexOf(it);if(Dt===-1){for(let At=0;At<w.length;At++)if(At>=b.length){b.push(it),Dt=At;break}else if(b[At]===null){b[At]=it,Dt=At;break}if(Dt===-1)break}const bt=w[Dt];bt&&bt.connect(it)}}const J=new U,et=new U;function at(Y,nt,it){J.setFromMatrixPosition(nt.matrixWorld),et.setFromMatrixPosition(it.matrixWorld);const Dt=J.distanceTo(et),bt=nt.projectionMatrix.elements,At=it.projectionMatrix.elements,ce=bt[14]/(bt[10]-1),kt=bt[14]/(bt[10]+1),Qt=(bt[9]+1)/bt[5],Xt=(bt[9]-1)/bt[5],Kt=(bt[8]-1)/bt[0],ye=(At[8]+1)/At[0],we=ce*Kt,Ce=ce*ye,Ie=Dt/(-Kt+ye),de=Ie*-Kt;if(nt.matrixWorld.decompose(Y.position,Y.quaternion,Y.scale),Y.translateX(de),Y.translateZ(Ie),Y.matrixWorld.compose(Y.position,Y.quaternion,Y.scale),Y.matrixWorldInverse.copy(Y.matrixWorld).invert(),bt[10]===-1)Y.projectionMatrix.copy(nt.projectionMatrix),Y.projectionMatrixInverse.copy(nt.projectionMatrixInverse);else{const ve=ce+Ie,L=kt+Ie,Ke=we-de,jt=Ce+(Dt-de),R=Qt*kt/L*ve,y=Xt*kt/L*ve;Y.projectionMatrix.makePerspective(Ke,jt,R,y,ve,L),Y.projectionMatrixInverse.copy(Y.projectionMatrix).invert()}}function rt(Y,nt){nt===null?Y.matrixWorld.copy(Y.matrix):Y.matrixWorld.multiplyMatrices(nt.matrixWorld,Y.matrix),Y.matrixWorldInverse.copy(Y.matrixWorld).invert()}this.updateCamera=function(Y){if(n===null)return;let nt=Y.near,it=Y.far;g.texture!==null&&(g.depthNear>0&&(nt=g.depthNear),g.depthFar>0&&(it=g.depthFar)),D.near=C.near=T.near=nt,D.far=C.far=T.far=it,(O!==D.near||H!==D.far)&&(n.updateRenderState({depthNear:D.near,depthFar:D.far}),O=D.near,H=D.far),D.layers.mask=Y.layers.mask|6,T.layers.mask=D.layers.mask&-5,C.layers.mask=D.layers.mask&-3;const Dt=Y.parent,bt=D.cameras;rt(D,Dt);for(let At=0;At<bt.length;At++)rt(bt[At],Dt);bt.length===2?at(D,T,C):D.projectionMatrix.copy(T.projectionMatrix),k(Y,D,Dt)};function k(Y,nt,it){it===null?Y.matrix.copy(nt.matrixWorld):(Y.matrix.copy(it.matrixWorld),Y.matrix.invert(),Y.matrix.multiply(nt.matrixWorld)),Y.matrix.decompose(Y.position,Y.quaternion,Y.scale),Y.updateMatrixWorld(!0),Y.projectionMatrix.copy(nt.projectionMatrix),Y.projectionMatrixInverse.copy(nt.projectionMatrixInverse),Y.isPerspectiveCamera&&(Y.fov=Wr*2*Math.atan(1/Y.projectionMatrix.elements[5]),Y.zoom=1)}this.getCamera=function(){return D},this.getFoveation=function(){if(!(u===null&&f===null))return l},this.setFoveation=function(Y){l=Y,u!==null&&(u.fixedFoveation=Y),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=Y)},this.hasDepthSensing=function(){return g.texture!==null},this.getDepthSensingMesh=function(){return g.getMesh(D)},this.getCameraTexture=function(Y){return m[Y]};let xt=null;function wt(Y,nt){if(c=nt.getViewerPose(h||a),p=nt,c!==null){const it=c.views;f!==null&&(t.setRenderTargetFramebuffer(v,f.framebuffer),t.setRenderTarget(v));let Dt=!1;it.length!==D.cameras.length&&(D.cameras.length=0,Dt=!0);for(let kt=0;kt<it.length;kt++){const Qt=it[kt];let Xt=null;if(f!==null)Xt=f.getViewport(Qt);else{const ye=d.getViewSubImage(u,Qt);Xt=ye.viewport,kt===0&&(t.setRenderTargetTextures(v,ye.colorTexture,ye.depthStencilTexture),t.setRenderTarget(v))}let Kt=P[kt];Kt===void 0&&(Kt=new ri,Kt.layers.enable(kt),Kt.viewport=new _e,P[kt]=Kt),Kt.matrix.fromArray(Qt.transform.matrix),Kt.matrix.decompose(Kt.position,Kt.quaternion,Kt.scale),Kt.projectionMatrix.fromArray(Qt.projectionMatrix),Kt.projectionMatrixInverse.copy(Kt.projectionMatrix).invert(),Kt.viewport.set(Xt.x,Xt.y,Xt.width,Xt.height),kt===0&&(D.matrix.copy(Kt.matrix),D.matrix.decompose(D.position,D.quaternion,D.scale)),Dt===!0&&D.cameras.push(Kt)}const bt=n.enabledFeatures;if(bt&&bt.includes("depth-sensing")&&n.depthUsage=="gpu-optimized"&&x){d=i.getBinding();const kt=d.getDepthInformation(it[0]);kt&&kt.isValid&&kt.texture&&g.init(kt,n.renderState)}if(bt&&bt.includes("camera-access")&&x){t.state.unbindTexture(),d=i.getBinding();for(let kt=0;kt<it.length;kt++){const Qt=it[kt].camera;if(Qt){let Xt=m[Qt];Xt||(Xt=new sf,m[Qt]=Xt);const Kt=d.getCameraImage(Qt);Xt.sourceTexture=Kt}}}}for(let it=0;it<w.length;it++){const Dt=b[it],bt=w[it];Dt!==null&&bt!==void 0&&bt.update(Dt,nt,h||a)}xt&&xt(Y,nt),nt.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:nt}),p=null}const Ct=new ff;Ct.setAnimationLoop(wt),this.setAnimationLoop=function(Y){xt=Y},this.dispose=function(){}}}const Ey=new ue,vf=new Ot;vf.set(-1,0,0,0,1,0,0,0,1);function Ty(r,t){function e(g,m){g.matrixAutoUpdate===!0&&g.updateMatrix(),m.value.copy(g.matrix)}function i(g,m){m.color.getRGB(g.fogColor.value,lf(r)),m.isFog?(g.fogNear.value=m.near,g.fogFar.value=m.far):m.isFogExp2&&(g.fogDensity.value=m.density)}function n(g,m,M,E,v){m.isNodeMaterial?m.uniformsNeedUpdate=!1:m.isMeshBasicMaterial?s(g,m):m.isMeshLambertMaterial?(s(g,m),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)):m.isMeshToonMaterial?(s(g,m),d(g,m)):m.isMeshPhongMaterial?(s(g,m),c(g,m),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)):m.isMeshStandardMaterial?(s(g,m),u(g,m),m.isMeshPhysicalMaterial&&f(g,m,v)):m.isMeshMatcapMaterial?(s(g,m),p(g,m)):m.isMeshDepthMaterial?s(g,m):m.isMeshDistanceMaterial?(s(g,m),x(g,m)):m.isMeshNormalMaterial?s(g,m):m.isLineBasicMaterial?(a(g,m),m.isLineDashedMaterial&&o(g,m)):m.isPointsMaterial?l(g,m,M,E):m.isSpriteMaterial?h(g,m):m.isShadowMaterial?(g.color.value.copy(m.color),g.opacity.value=m.opacity):m.isShaderMaterial&&(m.uniformsNeedUpdate=!1)}function s(g,m){g.opacity.value=m.opacity,m.color&&g.diffuse.value.copy(m.color),m.emissive&&g.emissive.value.copy(m.emissive).multiplyScalar(m.emissiveIntensity),m.map&&(g.map.value=m.map,e(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,e(m.alphaMap,g.alphaMapTransform)),m.bumpMap&&(g.bumpMap.value=m.bumpMap,e(m.bumpMap,g.bumpMapTransform),g.bumpScale.value=m.bumpScale,m.side===Ue&&(g.bumpScale.value*=-1)),m.normalMap&&(g.normalMap.value=m.normalMap,e(m.normalMap,g.normalMapTransform),g.normalScale.value.copy(m.normalScale),m.side===Ue&&g.normalScale.value.negate()),m.displacementMap&&(g.displacementMap.value=m.displacementMap,e(m.displacementMap,g.displacementMapTransform),g.displacementScale.value=m.displacementScale,g.displacementBias.value=m.displacementBias),m.emissiveMap&&(g.emissiveMap.value=m.emissiveMap,e(m.emissiveMap,g.emissiveMapTransform)),m.specularMap&&(g.specularMap.value=m.specularMap,e(m.specularMap,g.specularMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest);const M=t.get(m),E=M.envMap,v=M.envMapRotation;E&&(g.envMap.value=E,g.envMapRotation.value.setFromMatrix4(Ey.makeRotationFromEuler(v)).transpose(),E.isCubeTexture&&E.isRenderTargetTexture===!1&&g.envMapRotation.value.premultiply(vf),g.reflectivity.value=m.reflectivity,g.ior.value=m.ior,g.refractionRatio.value=m.refractionRatio),m.lightMap&&(g.lightMap.value=m.lightMap,g.lightMapIntensity.value=m.lightMapIntensity,e(m.lightMap,g.lightMapTransform)),m.aoMap&&(g.aoMap.value=m.aoMap,g.aoMapIntensity.value=m.aoMapIntensity,e(m.aoMap,g.aoMapTransform))}function a(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,m.map&&(g.map.value=m.map,e(m.map,g.mapTransform))}function o(g,m){g.dashSize.value=m.dashSize,g.totalSize.value=m.dashSize+m.gapSize,g.scale.value=m.scale}function l(g,m,M,E){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.size.value=m.size*M,g.scale.value=E*.5,m.map&&(g.map.value=m.map,e(m.map,g.uvTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,e(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function h(g,m){g.diffuse.value.copy(m.color),g.opacity.value=m.opacity,g.rotation.value=m.rotation,m.map&&(g.map.value=m.map,e(m.map,g.mapTransform)),m.alphaMap&&(g.alphaMap.value=m.alphaMap,e(m.alphaMap,g.alphaMapTransform)),m.alphaTest>0&&(g.alphaTest.value=m.alphaTest)}function c(g,m){g.specular.value.copy(m.specular),g.shininess.value=Math.max(m.shininess,1e-4)}function d(g,m){m.gradientMap&&(g.gradientMap.value=m.gradientMap)}function u(g,m){g.metalness.value=m.metalness,m.metalnessMap&&(g.metalnessMap.value=m.metalnessMap,e(m.metalnessMap,g.metalnessMapTransform)),g.roughness.value=m.roughness,m.roughnessMap&&(g.roughnessMap.value=m.roughnessMap,e(m.roughnessMap,g.roughnessMapTransform)),m.envMap&&(g.envMapIntensity.value=m.envMapIntensity)}function f(g,m,M){g.ior.value=m.ior,m.sheen>0&&(g.sheenColor.value.copy(m.sheenColor).multiplyScalar(m.sheen),g.sheenRoughness.value=m.sheenRoughness,m.sheenColorMap&&(g.sheenColorMap.value=m.sheenColorMap,e(m.sheenColorMap,g.sheenColorMapTransform)),m.sheenRoughnessMap&&(g.sheenRoughnessMap.value=m.sheenRoughnessMap,e(m.sheenRoughnessMap,g.sheenRoughnessMapTransform))),m.clearcoat>0&&(g.clearcoat.value=m.clearcoat,g.clearcoatRoughness.value=m.clearcoatRoughness,m.clearcoatMap&&(g.clearcoatMap.value=m.clearcoatMap,e(m.clearcoatMap,g.clearcoatMapTransform)),m.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=m.clearcoatRoughnessMap,e(m.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),m.clearcoatNormalMap&&(g.clearcoatNormalMap.value=m.clearcoatNormalMap,e(m.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(m.clearcoatNormalScale),m.side===Ue&&g.clearcoatNormalScale.value.negate())),m.dispersion>0&&(g.dispersion.value=m.dispersion),m.iridescence>0&&(g.iridescence.value=m.iridescence,g.iridescenceIOR.value=m.iridescenceIOR,g.iridescenceThicknessMinimum.value=m.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=m.iridescenceThicknessRange[1],m.iridescenceMap&&(g.iridescenceMap.value=m.iridescenceMap,e(m.iridescenceMap,g.iridescenceMapTransform)),m.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=m.iridescenceThicknessMap,e(m.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),m.transmission>0&&(g.transmission.value=m.transmission,g.transmissionSamplerMap.value=M.texture,g.transmissionSamplerSize.value.set(M.width,M.height),m.transmissionMap&&(g.transmissionMap.value=m.transmissionMap,e(m.transmissionMap,g.transmissionMapTransform)),g.thickness.value=m.thickness,m.thicknessMap&&(g.thicknessMap.value=m.thicknessMap,e(m.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=m.attenuationDistance,g.attenuationColor.value.copy(m.attenuationColor)),m.anisotropy>0&&(g.anisotropyVector.value.set(m.anisotropy*Math.cos(m.anisotropyRotation),m.anisotropy*Math.sin(m.anisotropyRotation)),m.anisotropyMap&&(g.anisotropyMap.value=m.anisotropyMap,e(m.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=m.specularIntensity,g.specularColor.value.copy(m.specularColor),m.specularColorMap&&(g.specularColorMap.value=m.specularColorMap,e(m.specularColorMap,g.specularColorMapTransform)),m.specularIntensityMap&&(g.specularIntensityMap.value=m.specularIntensityMap,e(m.specularIntensityMap,g.specularIntensityMapTransform))}function p(g,m){m.matcap&&(g.matcap.value=m.matcap)}function x(g,m){const M=t.get(m).light;g.referencePosition.value.setFromMatrixPosition(M.matrixWorld),g.nearDistance.value=M.shadow.camera.near,g.farDistance.value=M.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:n}}function Ay(r,t,e,i){let n={},s={},a=[];const o=r.getParameter(r.MAX_UNIFORM_BUFFER_BINDINGS);function l(v,w){const b=w.program;i.uniformBlockBinding(v,b)}function h(v,w){let b=n[v.id];b===void 0&&(g(v),b=c(v),n[v.id]=b,v.addEventListener("dispose",M));const A=w.program;i.updateUBOMapping(v,A);const _=t.render.frame;s[v.id]!==_&&(u(v),s[v.id]=_)}function c(v){const w=d();v.__bindingPointIndex=w;const b=r.createBuffer(),A=v.__size,_=v.usage;return r.bindBuffer(r.UNIFORM_BUFFER,b),r.bufferData(r.UNIFORM_BUFFER,A,_),r.bindBuffer(r.UNIFORM_BUFFER,null),r.bindBufferBase(r.UNIFORM_BUFFER,w,b),b}function d(){for(let v=0;v<o;v++)if(a.indexOf(v)===-1)return a.push(v),v;return Zt("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(v){const w=n[v.id],b=v.uniforms,A=v.__cache;r.bindBuffer(r.UNIFORM_BUFFER,w);for(let _=0,T=b.length;_<T;_++){const C=b[_];if(Array.isArray(C))for(let P=0,D=C.length;P<D;P++)f(C[P],_,P,A);else f(C,_,0,A)}r.bindBuffer(r.UNIFORM_BUFFER,null)}function f(v,w,b,A){if(x(v,w,b,A)===!0){const _=v.__offset,T=v.value;if(Array.isArray(T)){let C=0;for(let P=0;P<T.length;P++){const D=T[P],O=m(D);p(D,v.__data,C),typeof D!="number"&&typeof D!="boolean"&&!D.isMatrix3&&!ArrayBuffer.isView(D)&&(C+=O.storage/Float32Array.BYTES_PER_ELEMENT)}}else p(T,v.__data,0);r.bufferSubData(r.UNIFORM_BUFFER,_,v.__data)}}function p(v,w,b){typeof v=="number"||typeof v=="boolean"?w[0]=v:v.isMatrix3?(w[0]=v.elements[0],w[1]=v.elements[1],w[2]=v.elements[2],w[3]=0,w[4]=v.elements[3],w[5]=v.elements[4],w[6]=v.elements[5],w[7]=0,w[8]=v.elements[6],w[9]=v.elements[7],w[10]=v.elements[8],w[11]=0):ArrayBuffer.isView(v)?w.set(new v.constructor(v.buffer,v.byteOffset,w.length)):v.toArray(w,b)}function x(v,w,b,A){const _=v.value,T=w+"_"+b;if(A[T]===void 0)return typeof _=="number"||typeof _=="boolean"?A[T]=_:ArrayBuffer.isView(_)?A[T]=_.slice():A[T]=_.clone(),!0;{const C=A[T];if(typeof _=="number"||typeof _=="boolean"){if(C!==_)return A[T]=_,!0}else{if(ArrayBuffer.isView(_))return!0;if(C.equals(_)===!1)return C.copy(_),!0}}return!1}function g(v){const w=v.uniforms;let b=0;const A=16;for(let T=0,C=w.length;T<C;T++){const P=Array.isArray(w[T])?w[T]:[w[T]];for(let D=0,O=P.length;D<O;D++){const H=P[D],F=Array.isArray(H.value)?H.value:[H.value];for(let q=0,G=F.length;q<G;q++){const J=F[q],et=m(J),at=b%A,rt=at%et.boundary,k=at+rt;b+=rt,k!==0&&A-k<et.storage&&(b+=A-k),H.__data=new Float32Array(et.storage/Float32Array.BYTES_PER_ELEMENT),H.__offset=b,b+=et.storage}}}const _=b%A;return _>0&&(b+=A-_),v.__size=b,v.__cache={},this}function m(v){const w={boundary:0,storage:0};return typeof v=="number"||typeof v=="boolean"?(w.boundary=4,w.storage=4):v.isVector2?(w.boundary=8,w.storage=8):v.isVector3||v.isColor?(w.boundary=16,w.storage=12):v.isVector4?(w.boundary=16,w.storage=16):v.isMatrix3?(w.boundary=48,w.storage=48):v.isMatrix4?(w.boundary=64,w.storage=64):v.isTexture?Lt("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(v)?(w.boundary=16,w.storage=v.byteLength):Lt("WebGLRenderer: Unsupported uniform value type.",v),w}function M(v){const w=v.target;w.removeEventListener("dispose",M);const b=a.indexOf(w.__bindingPointIndex);a.splice(b,1),r.deleteBuffer(n[w.id]),delete n[w.id],delete s[w.id]}function E(){for(const v in n)r.deleteBuffer(n[v]);a=[],n={},s={}}return{bind:l,update:h,dispose:E}}const Ry=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]);let Fi=null;function Cy(){return Fi===null&&(Fi=new ef(Ry,16,16,Jn,ln),Fi.name="DFG_LUT",Fi.minFilter=He,Fi.magFilter=He,Fi.wrapS=nn,Fi.wrapT=nn,Fi.generateMipmaps=!1,Fi.needsUpdate=!0),Fi}class Py{constructor(t={}){const{canvas:e=Pp(),context:i=null,depth:n=!0,stencil:s=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:h=!1,powerPreference:c="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:u=!1,outputBufferType:f=ai}=t;this.isWebGLRenderer=!0;let p;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=i.getContextAttributes().alpha}else p=a;const x=f,g=new Set([Kh,Zh,Yh]),m=new Set([ai,Hi,Vr,Gr,Xh,qh]),M=new Uint32Array(4),E=new Int32Array(4),v=new U;let w=null,b=null;const A=[],_=[];let T=null;this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Ti,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const C=this;let P=!1,D=null,O=null,H=null,F=null;this._outputColorSpace=si;let q=0,G=0,J=null,et=-1,at=null;const rt=new _e,k=new _e;let xt=null;const wt=new Ft(0);let Ct=0,Y=e.width,nt=e.height,it=1,Dt=null,bt=null;const At=new _e(0,0,Y,nt),ce=new _e(0,0,Y,nt);let kt=!1;const Qt=new rc;let Xt=!1,Kt=!1;const ye=new ue,we=new U,Ce=new _e,Ie={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let de=!1;function ve(){return J===null?it:1}let L=i;function Ke(S,N){return e.getContext(S,N)}try{const S={alpha:!0,depth:n,stencil:s,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:h,powerPreference:c,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${zh}`),e.addEventListener("webglcontextlost",fe,!1),e.addEventListener("webglcontextrestored",oe,!1),e.addEventListener("webglcontextcreationerror",Di,!1),L===null){const N="webgl2";if(L=Ke(N,S),L===null)throw Ke(N)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}}catch(S){throw Zt("WebGLRenderer: "+S.message),S}let jt,R,y,z,W,Z,st,lt,K,j,ht,Et,dt,ct,Pt,It,Ut,I,ot,Q,ut,gt,tt;function St(){jt=new Cx(L),jt.init(),ut=new vy(L,jt),R=new Mx(L,jt,t,ut),y=new _y(L,jt),R.reversedDepthBuffer&&u&&y.buffers.depth.setReversed(!0),O=L.createFramebuffer(),H=L.createFramebuffer(),F=L.createFramebuffer(),z=new Ix(L),W=new sy,Z=new yy(L,jt,y,W,R,ut,z),st=new Rx(C),lt=new Um(L),gt=new yx(L,lt),K=new Px(L,lt,z,gt),j=new Nx(L,K,lt,gt,z),I=new Lx(L,R,Z),Pt=new bx(W),ht=new ny(C,st,jt,R,gt,Pt),Et=new Ty(C,W),dt=new ay,ct=new dy(jt),Ut=new _x(C,st,y,j,p,l),It=new xy(C,j,R),tt=new Ay(L,z,R,y),ot=new vx(L,jt,z),Q=new Dx(L,jt,z),z.programs=ht.programs,C.capabilities=R,C.extensions=jt,C.properties=W,C.renderLists=dt,C.shadowMap=It,C.state=y,C.info=z}St(),x!==ai&&(T=new Ux(x,e.width,e.height,o,n,s));const vt=new wy(C,L);this.xr=vt,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){const S=jt.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){const S=jt.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return it},this.setPixelRatio=function(S){S!==void 0&&(it=S,this.setSize(Y,nt,!1))},this.getSize=function(S){return S.set(Y,nt)},this.setSize=function(S,N,X=!0){if(vt.isPresenting){Lt("WebGLRenderer: Can't change size while VR device is presenting.");return}Y=S,nt=N,e.width=Math.floor(S*it),e.height=Math.floor(N*it),X===!0&&(e.style.width=S+"px",e.style.height=N+"px"),T!==null&&T.setSize(e.width,e.height),this.setViewport(0,0,S,N)},this.getDrawingBufferSize=function(S){return S.set(Y*it,nt*it).floor()},this.setDrawingBufferSize=function(S,N,X){Y=S,nt=N,it=X,e.width=Math.floor(S*X),e.height=Math.floor(N*X),this.setViewport(0,0,S,N)},this.setEffects=function(S){if(x===ai){Zt("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(S){for(let N=0;N<S.length;N++)if(S[N].isOutputPass===!0){Lt("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}T.setEffects(S||[])},this.getCurrentViewport=function(S){return S.copy(rt)},this.getViewport=function(S){return S.copy(At)},this.setViewport=function(S,N,X,B){S.isVector4?At.set(S.x,S.y,S.z,S.w):At.set(S,N,X,B),y.viewport(rt.copy(At).multiplyScalar(it).round())},this.getScissor=function(S){return S.copy(ce)},this.setScissor=function(S,N,X,B){S.isVector4?ce.set(S.x,S.y,S.z,S.w):ce.set(S,N,X,B),y.scissor(k.copy(ce).multiplyScalar(it).round())},this.getScissorTest=function(){return kt},this.setScissorTest=function(S){y.setScissorTest(kt=S)},this.setOpaqueSort=function(S){Dt=S},this.setTransparentSort=function(S){bt=S},this.getClearColor=function(S){return S.copy(Ut.getClearColor())},this.setClearColor=function(){Ut.setClearColor(...arguments)},this.getClearAlpha=function(){return Ut.getClearAlpha()},this.setClearAlpha=function(){Ut.setClearAlpha(...arguments)},this.clear=function(S=!0,N=!0,X=!0){let B=0;if(S){let V=!1;if(J!==null){const mt=J.texture.format;V=g.has(mt)}if(V){const mt=J.texture.type,yt=m.has(mt),pt=Ut.getClearColor(),Mt=Ut.getClearAlpha(),Tt=pt.r,zt=pt.g,Gt=pt.b;yt?(M[0]=Tt,M[1]=zt,M[2]=Gt,M[3]=Mt,L.clearBufferuiv(L.COLOR,0,M)):(E[0]=Tt,E[1]=zt,E[2]=Gt,E[3]=Mt,L.clearBufferiv(L.COLOR,0,E))}else B|=L.COLOR_BUFFER_BIT}N&&(B|=L.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),X&&(B|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),B!==0&&L.clear(B)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(S){S.setRenderer(this),D=S},this.dispose=function(){e.removeEventListener("webglcontextlost",fe,!1),e.removeEventListener("webglcontextrestored",oe,!1),e.removeEventListener("webglcontextcreationerror",Di,!1),Ut.dispose(),dt.dispose(),ct.dispose(),W.dispose(),st.dispose(),j.dispose(),gt.dispose(),tt.dispose(),ht.dispose(),vt.dispose(),vt.removeEventListener("sessionstart",dc),vt.removeEventListener("sessionend",fc),Un.stop()};function fe(S){S.preventDefault(),Cc("WebGLRenderer: Context Lost."),P=!0}function oe(){Cc("WebGLRenderer: Context Restored."),P=!1;const S=z.autoReset,N=It.enabled,X=It.autoUpdate,B=It.needsUpdate,V=It.type;St(),z.autoReset=S,It.enabled=N,It.autoUpdate=X,It.needsUpdate=B,It.type=V}function Di(S){Zt("WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function Ii(S){const N=S.target;N.removeEventListener("dispose",Ii),Gf(N)}function Gf(S){Hf(S),W.remove(S)}function Hf(S){const N=W.get(S).programs;N!==void 0&&(N.forEach(function(X){ht.releaseProgram(X)}),S.isShaderMaterial&&ht.releaseShaderCache(S))}this.renderBufferDirect=function(S,N,X,B,V,mt){N===null&&(N=Ie);const yt=V.isMesh&&V.matrixWorld.determinantAffine()<0,pt=qf(S,N,X,B,V);y.setMaterial(B,yt);let Mt=X.index,Tt=1;if(B.wireframe===!0){if(Mt=K.getWireframeAttribute(X),Mt===void 0)return;Tt=2}const zt=X.drawRange,Gt=X.attributes.position;let Rt=zt.start*Tt,ee=(zt.start+zt.count)*Tt;mt!==null&&(Rt=Math.max(Rt,mt.start*Tt),ee=Math.min(ee,(mt.start+mt.count)*Tt)),Mt!==null?(Rt=Math.max(Rt,0),ee=Math.min(ee,Mt.count)):Gt!=null&&(Rt=Math.max(Rt,0),ee=Math.min(ee,Gt.count));const ge=ee-Rt;if(ge<0||ge===1/0)return;gt.setup(V,B,pt,X,Mt);let pe,re=ot;if(Mt!==null&&(pe=lt.get(Mt),re=Q,re.setIndex(pe)),V.isMesh)B.wireframe===!0?(y.setLineWidth(B.wireframeLinewidth*ve()),re.setMode(L.LINES)):re.setMode(L.TRIANGLES);else if(V.isLine){let Oe=B.linewidth;Oe===void 0&&(Oe=1),y.setLineWidth(Oe*ve()),V.isLineSegments?re.setMode(L.LINES):V.isLineLoop?re.setMode(L.LINE_LOOP):re.setMode(L.LINE_STRIP)}else V.isPoints?re.setMode(L.POINTS):V.isSprite&&re.setMode(L.TRIANGLES);if(V.isBatchedMesh)if(jt.get("WEBGL_multi_draw"))re.renderMultiDraw(V._multiDrawStarts,V._multiDrawCounts,V._multiDrawCount);else{const Oe=V._multiDrawStarts,_t=V._multiDrawCounts,je=V._multiDrawCount,Jt=Mt?lt.get(Mt).bytesPerElement:1,li=W.get(B).currentProgram.getUniforms();for(let Li=0;Li<je;Li++)li.setValue(L,"_gl_DrawID",Li),re.render(Oe[Li]/Jt,_t[Li])}else if(V.isInstancedMesh)re.renderInstances(Rt,ge,V.count);else if(X.isInstancedBufferGeometry){const Oe=X._maxInstanceCount!==void 0?X._maxInstanceCount:1/0,_t=Math.min(X.instanceCount,Oe);re.renderInstances(Rt,ge,_t)}else re.render(Rt,ge)};function uc(S,N,X){S.transparent===!0&&S.side===en&&S.forceSinglePass===!1?(S.side=Ue,S.needsUpdate=!0,Jr(S,N,X),S.side=Dn,S.needsUpdate=!0,Jr(S,N,X),S.side=en):Jr(S,N,X)}this.compile=function(S,N,X=null){X===null&&(X=S),b=ct.get(X),b.init(N),_.push(b),X.traverseVisible(function(V){V.isLight&&V.layers.test(N.layers)&&(b.pushLight(V),V.castShadow&&b.pushShadow(V))}),S!==X&&S.traverseVisible(function(V){V.isLight&&V.layers.test(N.layers)&&(b.pushLight(V),V.castShadow&&b.pushShadow(V))}),b.setupLights();const B=new Set;return S.traverse(function(V){if(!(V.isMesh||V.isPoints||V.isLine||V.isSprite))return;const mt=V.material;if(mt)if(Array.isArray(mt))for(let yt=0;yt<mt.length;yt++){const pt=mt[yt];uc(pt,X,V),B.add(pt)}else uc(mt,X,V),B.add(mt)}),b=_.pop(),B},this.compileAsync=function(S,N,X=null){const B=this.compile(S,N,X);return new Promise(V=>{function mt(){if(B.forEach(function(yt){W.get(yt).currentProgram.isReady()&&B.delete(yt)}),B.size===0){V(S);return}setTimeout(mt,10)}jt.get("KHR_parallel_shader_compile")!==null?mt():setTimeout(mt,10)})};let Co=null;function Wf(S){Co&&Co(S)}function dc(){Un.stop()}function fc(){Un.start()}const Un=new ff;Un.setAnimationLoop(Wf),typeof self<"u"&&Un.setContext(self),this.setAnimationLoop=function(S){Co=S,vt.setAnimationLoop(S),S===null?Un.stop():Un.start()},vt.addEventListener("sessionstart",dc),vt.addEventListener("sessionend",fc),this.render=function(S,N){if(N!==void 0&&N.isCamera!==!0){Zt("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;D!==null&&D.renderStart(S,N);const X=vt.enabled===!0&&vt.isPresenting===!0,B=T!==null&&(J===null||X)&&T.begin(C,J);if(S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),N.parent===null&&N.matrixWorldAutoUpdate===!0&&N.updateMatrixWorld(),vt.enabled===!0&&vt.isPresenting===!0&&(T===null||T.isCompositing()===!1)&&(vt.cameraAutoUpdate===!0&&vt.updateCamera(N),N=vt.getCamera()),S.isScene===!0&&S.onBeforeRender(C,S,N,J),b=ct.get(S,_.length),b.init(N),b.state.textureUnits=Z.getTextureUnits(),_.push(b),ye.multiplyMatrices(N.projectionMatrix,N.matrixWorldInverse),Qt.setFromProjectionMatrix(ye,Bi,N.reversedDepth),Kt=this.localClippingEnabled,Xt=Pt.init(this.clippingPlanes,Kt),w=dt.get(S,A.length),w.init(),A.push(w),vt.enabled===!0&&vt.isPresenting===!0){const yt=C.xr.getDepthSensingMesh();yt!==null&&Po(yt,N,-1/0,C.sortObjects)}Po(S,N,0,C.sortObjects),w.finish(),C.sortObjects===!0&&w.sort(Dt,bt,N.reversedDepth),de=vt.enabled===!1||vt.isPresenting===!1||vt.hasDepthSensing()===!1,de&&Ut.addToRenderList(w,S),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),Xt===!0&&Pt.beginShadows();const V=b.state.shadowsArray;if(It.render(V,S,N),Xt===!0&&Pt.endShadows(),(B&&T.hasRenderPass())===!1){const yt=w.opaque,pt=w.transmissive;if(b.setupLights(),N.isArrayCamera){const Mt=N.cameras;if(pt.length>0)for(let Tt=0,zt=Mt.length;Tt<zt;Tt++){const Gt=Mt[Tt];mc(yt,pt,S,Gt)}de&&Ut.render(S);for(let Tt=0,zt=Mt.length;Tt<zt;Tt++){const Gt=Mt[Tt];pc(w,S,Gt,Gt.viewport)}}else pt.length>0&&mc(yt,pt,S,N),de&&Ut.render(S),pc(w,S,N)}J!==null&&G===0&&(Z.updateMultisampleRenderTarget(J),Z.updateRenderTargetMipmap(J)),B&&T.end(C),S.isScene===!0&&S.onAfterRender(C,S,N),gt.resetDefaultState(),et=-1,at=null,_.pop(),_.length>0?(b=_[_.length-1],Z.setTextureUnits(b.state.textureUnits),Xt===!0&&Pt.setGlobalState(C.clippingPlanes,b.state.camera)):b=null,A.pop(),A.length>0?w=A[A.length-1]:w=null,D!==null&&D.renderEnd()};function Po(S,N,X,B){if(S.visible===!1)return;if(S.layers.test(N.layers)){if(S.isGroup)X=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(N);else if(S.isLightProbeGrid)b.pushLightProbeGrid(S);else if(S.isLight)b.pushLight(S),S.castShadow&&b.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||Qt.intersectsSprite(S)){B&&Ce.setFromMatrixPosition(S.matrixWorld).applyMatrix4(ye);const yt=j.update(S),pt=S.material;pt.visible&&w.push(S,yt,pt,X,Ce.z,null)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||Qt.intersectsObject(S))){const yt=j.update(S),pt=S.material;if(B&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),Ce.copy(S.boundingSphere.center)):(yt.boundingSphere===null&&yt.computeBoundingSphere(),Ce.copy(yt.boundingSphere.center)),Ce.applyMatrix4(S.matrixWorld).applyMatrix4(ye)),Array.isArray(pt)){const Mt=yt.groups;for(let Tt=0,zt=Mt.length;Tt<zt;Tt++){const Gt=Mt[Tt],Rt=pt[Gt.materialIndex];Rt&&Rt.visible&&w.push(S,yt,Rt,X,Ce.z,Gt)}}else pt.visible&&w.push(S,yt,pt,X,Ce.z,null)}}const mt=S.children;for(let yt=0,pt=mt.length;yt<pt;yt++)Po(mt[yt],N,X,B)}function pc(S,N,X,B){const{opaque:V,transmissive:mt,transparent:yt}=S;b.setupLightsView(X),Xt===!0&&Pt.setGlobalState(C.clippingPlanes,X),B&&y.viewport(rt.copy(B)),V.length>0&&Kr(V,N,X),mt.length>0&&Kr(mt,N,X),yt.length>0&&Kr(yt,N,X),y.buffers.depth.setTest(!0),y.buffers.depth.setMask(!0),y.buffers.color.setMask(!0),y.setPolygonOffset(!1)}function mc(S,N,X,B){if((X.isScene===!0?X.overrideMaterial:null)!==null)return;if(b.state.transmissionRenderTarget[B.id]===void 0){const Rt=jt.has("EXT_color_buffer_half_float")||jt.has("EXT_color_buffer_float");b.state.transmissionRenderTarget[B.id]=new Gi(1,1,{generateMipmaps:!0,type:Rt?ln:ai,minFilter:Yn,samples:Math.max(4,R.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:$t.workingColorSpace})}const mt=b.state.transmissionRenderTarget[B.id],yt=B.viewport||rt;mt.setSize(yt.z*C.transmissionResolutionScale,yt.w*C.transmissionResolutionScale);const pt=C.getRenderTarget(),Mt=C.getActiveCubeFace(),Tt=C.getActiveMipmapLevel();C.setRenderTarget(mt),C.getClearColor(wt),Ct=C.getClearAlpha(),Ct<1&&C.setClearColor(16777215,.5),C.clear(),de&&Ut.render(X);const zt=C.toneMapping;C.toneMapping=Ti;const Gt=B.viewport;if(B.viewport!==void 0&&(B.viewport=void 0),b.setupLightsView(B),Xt===!0&&Pt.setGlobalState(C.clippingPlanes,B),Kr(S,X,B),Z.updateMultisampleRenderTarget(mt),Z.updateRenderTargetMipmap(mt),jt.has("WEBGL_multisampled_render_to_texture")===!1){let Rt=!1;for(let ee=0,ge=N.length;ee<ge;ee++){const pe=N[ee],{object:re,geometry:Oe,material:_t,group:je}=pe;if(_t.side===en&&re.layers.test(B.layers)){const Jt=_t.side;_t.side=Ue,_t.needsUpdate=!0,gc(re,X,B,Oe,_t,je),_t.side=Jt,_t.needsUpdate=!0,Rt=!0}}Rt===!0&&(Z.updateMultisampleRenderTarget(mt),Z.updateRenderTargetMipmap(mt))}C.setRenderTarget(pt,Mt,Tt),C.setClearColor(wt,Ct),Gt!==void 0&&(B.viewport=Gt),C.toneMapping=zt}function Kr(S,N,X){const B=N.isScene===!0?N.overrideMaterial:null;for(let V=0,mt=S.length;V<mt;V++){const yt=S[V],{object:pt,geometry:Mt,group:Tt}=yt;let zt=yt.material;zt.allowOverride===!0&&B!==null&&(zt=B),pt.layers.test(X.layers)&&gc(pt,N,X,Mt,zt,Tt)}}function gc(S,N,X,B,V,mt){S.onBeforeRender(C,N,X,B,V,mt),S.modelViewMatrix.multiplyMatrices(X.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),V.onBeforeRender(C,N,X,B,S,mt),V.transparent===!0&&V.side===en&&V.forceSinglePass===!1?(V.side=Ue,V.needsUpdate=!0,C.renderBufferDirect(X,N,B,V,S,mt),V.side=Dn,V.needsUpdate=!0,C.renderBufferDirect(X,N,B,V,S,mt),V.side=en):C.renderBufferDirect(X,N,B,V,S,mt),S.onAfterRender(C,N,X,B,V,mt)}function Jr(S,N,X){N.isScene!==!0&&(N=Ie);const B=W.get(S),V=b.state.lights,mt=b.state.shadowsArray,yt=V.state.version,pt=ht.getParameters(S,V.state,mt,N,X,b.state.lightProbeGridArray),Mt=ht.getProgramCacheKey(pt);let Tt=B.programs;B.environment=S.isMeshStandardMaterial||S.isMeshLambertMaterial||S.isMeshPhongMaterial?N.environment:null,B.fog=N.fog;const zt=S.isMeshStandardMaterial||S.isMeshLambertMaterial&&!S.envMap||S.isMeshPhongMaterial&&!S.envMap;B.envMap=st.get(S.envMap||B.environment,zt),B.envMapRotation=B.environment!==null&&S.envMap===null?N.environmentRotation:S.envMapRotation,Tt===void 0&&(S.addEventListener("dispose",Ii),Tt=new Map,B.programs=Tt);let Gt=Tt.get(Mt);if(Gt!==void 0){if(B.currentProgram===Gt&&B.lightsStateVersion===yt)return _c(S,pt),Gt}else pt.uniforms=ht.getUniforms(S),D!==null&&S.isNodeMaterial&&D.build(S,X,pt),S.onBeforeCompile(pt,C),Gt=ht.acquireProgram(pt,Mt),Tt.set(Mt,Gt),B.uniforms=pt.uniforms;const Rt=B.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(Rt.clippingPlanes=Pt.uniform),_c(S,pt),B.needsLights=Yf(S),B.lightsStateVersion=yt,B.needsLights&&(Rt.ambientLightColor.value=V.state.ambient,Rt.lightProbe.value=V.state.probe,Rt.directionalLights.value=V.state.directional,Rt.directionalLightShadows.value=V.state.directionalShadow,Rt.spotLights.value=V.state.spot,Rt.spotLightShadows.value=V.state.spotShadow,Rt.rectAreaLights.value=V.state.rectArea,Rt.ltc_1.value=V.state.rectAreaLTC1,Rt.ltc_2.value=V.state.rectAreaLTC2,Rt.pointLights.value=V.state.point,Rt.pointLightShadows.value=V.state.pointShadow,Rt.hemisphereLights.value=V.state.hemi,Rt.directionalShadowMatrix.value=V.state.directionalShadowMatrix,Rt.spotLightMatrix.value=V.state.spotLightMatrix,Rt.spotLightMap.value=V.state.spotLightMap,Rt.pointShadowMatrix.value=V.state.pointShadowMatrix),B.lightProbeGrid=b.state.lightProbeGridArray.length>0,B.currentProgram=Gt,B.uniformsList=null,Gt}function xc(S){if(S.uniformsList===null){const N=S.currentProgram.getUniforms();S.uniformsList=no.seqWithValue(N.seq,S.uniforms)}return S.uniformsList}function _c(S,N){const X=W.get(S);X.outputColorSpace=N.outputColorSpace,X.batching=N.batching,X.batchingColor=N.batchingColor,X.instancing=N.instancing,X.instancingColor=N.instancingColor,X.instancingMorph=N.instancingMorph,X.skinning=N.skinning,X.morphTargets=N.morphTargets,X.morphNormals=N.morphNormals,X.morphColors=N.morphColors,X.morphTargetsCount=N.morphTargetsCount,X.numClippingPlanes=N.numClippingPlanes,X.numIntersection=N.numClipIntersection,X.vertexAlphas=N.vertexAlphas,X.vertexTangents=N.vertexTangents,X.toneMapping=N.toneMapping}function Xf(S,N){if(S.length===0)return null;if(S.length===1)return S[0].texture!==null?S[0]:null;v.setFromMatrixPosition(N.matrixWorld);for(let X=0,B=S.length;X<B;X++){const V=S[X];if(V.texture!==null&&V.boundingBox.containsPoint(v))return V}return null}function qf(S,N,X,B,V){N.isScene!==!0&&(N=Ie),Z.resetTextureUnits();const mt=N.fog,yt=B.isMeshStandardMaterial||B.isMeshLambertMaterial||B.isMeshPhongMaterial?N.environment:null,pt=J===null?C.outputColorSpace:J.isXRRenderTarget===!0?J.texture.colorSpace:$t.workingColorSpace,Mt=B.isMeshStandardMaterial||B.isMeshLambertMaterial&&!B.envMap||B.isMeshPhongMaterial&&!B.envMap,Tt=st.get(B.envMap||yt,Mt),zt=B.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,Gt=!!X.attributes.tangent&&(!!B.normalMap||B.anisotropy>0),Rt=!!X.morphAttributes.position,ee=!!X.morphAttributes.normal,ge=!!X.morphAttributes.color;let pe=Ti;B.toneMapped&&(J===null||J.isXRRenderTarget===!0)&&(pe=C.toneMapping);const re=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,Oe=re!==void 0?re.length:0,_t=W.get(B),je=b.state.lights;if(Xt===!0&&(Kt===!0||S!==at)){const le=S===at&&B.id===et;Pt.setState(B,S,le)}let Jt=!1;B.version===_t.__version?(_t.needsLights&&_t.lightsStateVersion!==je.state.version||_t.outputColorSpace!==pt||V.isBatchedMesh&&_t.batching===!1||!V.isBatchedMesh&&_t.batching===!0||V.isBatchedMesh&&_t.batchingColor===!0&&V.colorTexture===null||V.isBatchedMesh&&_t.batchingColor===!1&&V.colorTexture!==null||V.isInstancedMesh&&_t.instancing===!1||!V.isInstancedMesh&&_t.instancing===!0||V.isSkinnedMesh&&_t.skinning===!1||!V.isSkinnedMesh&&_t.skinning===!0||V.isInstancedMesh&&_t.instancingColor===!0&&V.instanceColor===null||V.isInstancedMesh&&_t.instancingColor===!1&&V.instanceColor!==null||V.isInstancedMesh&&_t.instancingMorph===!0&&V.morphTexture===null||V.isInstancedMesh&&_t.instancingMorph===!1&&V.morphTexture!==null||_t.envMap!==Tt||B.fog===!0&&_t.fog!==mt||_t.numClippingPlanes!==void 0&&(_t.numClippingPlanes!==Pt.numPlanes||_t.numIntersection!==Pt.numIntersection)||_t.vertexAlphas!==zt||_t.vertexTangents!==Gt||_t.morphTargets!==Rt||_t.morphNormals!==ee||_t.morphColors!==ge||_t.toneMapping!==pe||_t.morphTargetsCount!==Oe||!!_t.lightProbeGrid!=b.state.lightProbeGridArray.length>0)&&(Jt=!0):(Jt=!0,_t.__version=B.version);let li=_t.currentProgram;Jt===!0&&(li=Jr(B,N,V),D&&B.isNodeMaterial&&D.onUpdateProgram(B,li,_t));let Li=!1,un=!1,is=!1;const ae=li.getUniforms(),xe=_t.uniforms;if(y.useProgram(li.program)&&(Li=!0,un=!0,is=!0),B.id!==et&&(et=B.id,un=!0),_t.needsLights){const le=Xf(b.state.lightProbeGridArray,V);_t.lightProbeGrid!==le&&(_t.lightProbeGrid=le,un=!0)}if(Li||at!==S){y.buffers.depth.getReversed()&&S.reversedDepth!==!0&&(S._reversedDepth=!0,S.updateProjectionMatrix()),ae.setValue(L,"projectionMatrix",S.projectionMatrix),ae.setValue(L,"viewMatrix",S.matrixWorldInverse);const fn=ae.map.cameraPosition;fn!==void 0&&fn.setValue(L,we.setFromMatrixPosition(S.matrixWorld)),R.logarithmicDepthBuffer&&ae.setValue(L,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(B.isMeshPhongMaterial||B.isMeshToonMaterial||B.isMeshLambertMaterial||B.isMeshBasicMaterial||B.isMeshStandardMaterial||B.isShaderMaterial)&&ae.setValue(L,"isOrthographic",S.isOrthographicCamera===!0),at!==S&&(at=S,un=!0,is=!0)}if(_t.needsLights&&(je.state.directionalShadowMap.length>0&&ae.setValue(L,"directionalShadowMap",je.state.directionalShadowMap,Z),je.state.spotShadowMap.length>0&&ae.setValue(L,"spotShadowMap",je.state.spotShadowMap,Z),je.state.pointShadowMap.length>0&&ae.setValue(L,"pointShadowMap",je.state.pointShadowMap,Z)),V.isSkinnedMesh){ae.setOptional(L,V,"bindMatrix"),ae.setOptional(L,V,"bindMatrixInverse");const le=V.skeleton;le&&(le.boneTexture===null&&le.computeBoneTexture(),ae.setValue(L,"boneTexture",le.boneTexture,Z))}V.isBatchedMesh&&(ae.setOptional(L,V,"batchingTexture"),ae.setValue(L,"batchingTexture",V._matricesTexture,Z),ae.setOptional(L,V,"batchingIdTexture"),ae.setValue(L,"batchingIdTexture",V._indirectTexture,Z),ae.setOptional(L,V,"batchingColorTexture"),V._colorsTexture!==null&&ae.setValue(L,"batchingColorTexture",V._colorsTexture,Z));const dn=X.morphAttributes;if((dn.position!==void 0||dn.normal!==void 0||dn.color!==void 0)&&I.update(V,X,li),(un||_t.receiveShadow!==V.receiveShadow)&&(_t.receiveShadow=V.receiveShadow,ae.setValue(L,"receiveShadow",V.receiveShadow)),(B.isMeshStandardMaterial||B.isMeshLambertMaterial||B.isMeshPhongMaterial)&&B.envMap===null&&N.environment!==null&&(xe.envMapIntensity.value=N.environmentIntensity),xe.dfgLUT!==void 0&&(xe.dfgLUT.value=Cy()),un){if(ae.setValue(L,"toneMappingExposure",C.toneMappingExposure),_t.needsLights&&$f(xe,is),mt&&B.fog===!0&&Et.refreshFogUniforms(xe,mt),Et.refreshMaterialUniforms(xe,B,it,nt,b.state.transmissionRenderTarget[S.id]),_t.needsLights&&_t.lightProbeGrid){const le=_t.lightProbeGrid;xe.probesSH.value=le.texture,xe.probesMin.value.copy(le.boundingBox.min),xe.probesMax.value.copy(le.boundingBox.max),xe.probesResolution.value.copy(le.resolution)}no.upload(L,xc(_t),xe,Z)}if(B.isShaderMaterial&&B.uniformsNeedUpdate===!0&&(no.upload(L,xc(_t),xe,Z),B.uniformsNeedUpdate=!1),B.isSpriteMaterial&&ae.setValue(L,"center",V.center),ae.setValue(L,"modelViewMatrix",V.modelViewMatrix),ae.setValue(L,"normalMatrix",V.normalMatrix),ae.setValue(L,"modelMatrix",V.matrixWorld),B.uniformsGroups!==void 0){const le=B.uniformsGroups;for(let fn=0,ns=le.length;fn<ns;fn++){const yc=le[fn];tt.update(yc,li),tt.bind(yc,li)}}return li}function $f(S,N){S.ambientLightColor.needsUpdate=N,S.lightProbe.needsUpdate=N,S.directionalLights.needsUpdate=N,S.directionalLightShadows.needsUpdate=N,S.pointLights.needsUpdate=N,S.pointLightShadows.needsUpdate=N,S.spotLights.needsUpdate=N,S.spotLightShadows.needsUpdate=N,S.rectAreaLights.needsUpdate=N,S.hemisphereLights.needsUpdate=N}function Yf(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return q},this.getActiveMipmapLevel=function(){return G},this.getRenderTarget=function(){return J},this.setRenderTargetTextures=function(S,N,X){const B=W.get(S);B.__autoAllocateDepthBuffer=S.resolveDepthBuffer===!1,B.__autoAllocateDepthBuffer===!1&&(B.__useRenderToTexture=!1),W.get(S.texture).__webglTexture=N,W.get(S.depthTexture).__webglTexture=B.__autoAllocateDepthBuffer?void 0:X,B.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(S,N){const X=W.get(S);X.__webglFramebuffer=N,X.__useDefaultFramebuffer=N===void 0},this.setRenderTarget=function(S,N=0,X=0){J=S,q=N,G=X;let B=null,V=!1,mt=!1;if(S){const pt=W.get(S);if(pt.__useDefaultFramebuffer!==void 0){y.bindFramebuffer(L.FRAMEBUFFER,pt.__webglFramebuffer),rt.copy(S.viewport),k.copy(S.scissor),xt=S.scissorTest,y.viewport(rt),y.scissor(k),y.setScissorTest(xt),et=-1;return}else if(pt.__webglFramebuffer===void 0)Z.setupRenderTarget(S);else if(pt.__hasExternalTextures)Z.rebindTextures(S,W.get(S.texture).__webglTexture,W.get(S.depthTexture).__webglTexture);else if(S.depthBuffer){const zt=S.depthTexture;if(pt.__boundDepthTexture!==zt){if(zt!==null&&W.has(zt)&&(S.width!==zt.image.width||S.height!==zt.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");Z.setupDepthRenderbuffer(S)}}const Mt=S.texture;(Mt.isData3DTexture||Mt.isDataArrayTexture||Mt.isCompressedArrayTexture)&&(mt=!0);const Tt=W.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(Tt[N])?B=Tt[N][X]:B=Tt[N],V=!0):S.samples>0&&Z.useMultisampledRTT(S)===!1?B=W.get(S).__webglMultisampledFramebuffer:Array.isArray(Tt)?B=Tt[X]:B=Tt,rt.copy(S.viewport),k.copy(S.scissor),xt=S.scissorTest}else rt.copy(At).multiplyScalar(it).floor(),k.copy(ce).multiplyScalar(it).floor(),xt=kt;if(X!==0&&(B=O),y.bindFramebuffer(L.FRAMEBUFFER,B)&&y.drawBuffers(S,B),y.viewport(rt),y.scissor(k),y.setScissorTest(xt),V){const pt=W.get(S.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+N,pt.__webglTexture,X)}else if(mt){const pt=N;for(let Mt=0;Mt<S.textures.length;Mt++){const Tt=W.get(S.textures[Mt]);L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0+Mt,Tt.__webglTexture,X,pt)}}else if(S!==null&&X!==0){const pt=W.get(S.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,pt.__webglTexture,X)}et=-1},this.readRenderTargetPixels=function(S,N,X,B,V,mt,yt,pt=0){if(!(S&&S.isWebGLRenderTarget)){Zt("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Mt=W.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&yt!==void 0&&(Mt=Mt[yt]),Mt){y.bindFramebuffer(L.FRAMEBUFFER,Mt);try{const Tt=S.textures[pt],zt=Tt.format,Gt=Tt.type;if(S.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+pt),!R.textureFormatReadable(zt)){Zt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!R.textureTypeReadable(Gt)){Zt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}N>=0&&N<=S.width-B&&X>=0&&X<=S.height-V&&L.readPixels(N,X,B,V,ut.convert(zt),ut.convert(Gt),mt)}finally{const Tt=J!==null?W.get(J).__webglFramebuffer:null;y.bindFramebuffer(L.FRAMEBUFFER,Tt)}}},this.readRenderTargetPixelsAsync=async function(S,N,X,B,V,mt,yt,pt=0){if(!(S&&S.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Mt=W.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&yt!==void 0&&(Mt=Mt[yt]),Mt)if(N>=0&&N<=S.width-B&&X>=0&&X<=S.height-V){y.bindFramebuffer(L.FRAMEBUFFER,Mt);const Tt=S.textures[pt],zt=Tt.format,Gt=Tt.type;if(S.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+pt),!R.textureFormatReadable(zt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!R.textureTypeReadable(Gt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const Rt=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,Rt),L.bufferData(L.PIXEL_PACK_BUFFER,mt.byteLength,L.STREAM_READ),L.readPixels(N,X,B,V,ut.convert(zt),ut.convert(Gt),0);const ee=J!==null?W.get(J).__webglFramebuffer:null;y.bindFramebuffer(L.FRAMEBUFFER,ee);const ge=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await Dp(L,ge,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,Rt),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,mt),L.deleteBuffer(Rt),L.deleteSync(ge),mt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(S,N=null,X=0){const B=Math.pow(2,-X),V=Math.floor(S.image.width*B),mt=Math.floor(S.image.height*B),yt=N!==null?N.x:0,pt=N!==null?N.y:0;Z.setTexture2D(S,0),L.copyTexSubImage2D(L.TEXTURE_2D,X,0,0,yt,pt,V,mt),y.unbindTexture()},this.copyTextureToTexture=function(S,N,X=null,B=null,V=0,mt=0){let yt,pt,Mt,Tt,zt,Gt,Rt,ee,ge;const pe=S.isCompressedTexture?S.mipmaps[mt]:S.image;if(X!==null)yt=X.max.x-X.min.x,pt=X.max.y-X.min.y,Mt=X.isBox3?X.max.z-X.min.z:1,Tt=X.min.x,zt=X.min.y,Gt=X.isBox3?X.min.z:0;else{const xe=Math.pow(2,-V);yt=Math.floor(pe.width*xe),pt=Math.floor(pe.height*xe),S.isDataArrayTexture?Mt=pe.depth:S.isData3DTexture?Mt=Math.floor(pe.depth*xe):Mt=1,Tt=0,zt=0,Gt=0}B!==null?(Rt=B.x,ee=B.y,ge=B.z):(Rt=0,ee=0,ge=0);const re=ut.convert(N.format),Oe=ut.convert(N.type);let _t;N.isData3DTexture?(Z.setTexture3D(N,0),_t=L.TEXTURE_3D):N.isDataArrayTexture||N.isCompressedArrayTexture?(Z.setTexture2DArray(N,0),_t=L.TEXTURE_2D_ARRAY):(Z.setTexture2D(N,0),_t=L.TEXTURE_2D),y.activeTexture(L.TEXTURE0),y.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,N.flipY),y.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,N.premultiplyAlpha),y.pixelStorei(L.UNPACK_ALIGNMENT,N.unpackAlignment);const je=y.getParameter(L.UNPACK_ROW_LENGTH),Jt=y.getParameter(L.UNPACK_IMAGE_HEIGHT),li=y.getParameter(L.UNPACK_SKIP_PIXELS),Li=y.getParameter(L.UNPACK_SKIP_ROWS),un=y.getParameter(L.UNPACK_SKIP_IMAGES);y.pixelStorei(L.UNPACK_ROW_LENGTH,pe.width),y.pixelStorei(L.UNPACK_IMAGE_HEIGHT,pe.height),y.pixelStorei(L.UNPACK_SKIP_PIXELS,Tt),y.pixelStorei(L.UNPACK_SKIP_ROWS,zt),y.pixelStorei(L.UNPACK_SKIP_IMAGES,Gt);const is=S.isDataArrayTexture||S.isData3DTexture,ae=N.isDataArrayTexture||N.isData3DTexture;if(S.isDepthTexture){const xe=W.get(S),dn=W.get(N),le=W.get(xe.__renderTarget),fn=W.get(dn.__renderTarget);y.bindFramebuffer(L.READ_FRAMEBUFFER,le.__webglFramebuffer),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,fn.__webglFramebuffer);for(let ns=0;ns<Mt;ns++)is&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,W.get(S).__webglTexture,V,Gt+ns),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,W.get(N).__webglTexture,mt,ge+ns)),L.blitFramebuffer(Tt,zt,yt,pt,Rt,ee,yt,pt,L.DEPTH_BUFFER_BIT,L.NEAREST);y.bindFramebuffer(L.READ_FRAMEBUFFER,null),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(V!==0||S.isRenderTargetTexture||W.has(S)){const xe=W.get(S),dn=W.get(N);y.bindFramebuffer(L.READ_FRAMEBUFFER,H),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,F);for(let le=0;le<Mt;le++)is?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,xe.__webglTexture,V,Gt+le):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,xe.__webglTexture,V),ae?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,dn.__webglTexture,mt,ge+le):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,dn.__webglTexture,mt),V!==0?L.blitFramebuffer(Tt,zt,yt,pt,Rt,ee,yt,pt,L.COLOR_BUFFER_BIT,L.NEAREST):ae?L.copyTexSubImage3D(_t,mt,Rt,ee,ge+le,Tt,zt,yt,pt):L.copyTexSubImage2D(_t,mt,Rt,ee,Tt,zt,yt,pt);y.bindFramebuffer(L.READ_FRAMEBUFFER,null),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else ae?S.isDataTexture||S.isData3DTexture?L.texSubImage3D(_t,mt,Rt,ee,ge,yt,pt,Mt,re,Oe,pe.data):N.isCompressedArrayTexture?L.compressedTexSubImage3D(_t,mt,Rt,ee,ge,yt,pt,Mt,re,pe.data):L.texSubImage3D(_t,mt,Rt,ee,ge,yt,pt,Mt,re,Oe,pe):S.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,mt,Rt,ee,yt,pt,re,Oe,pe.data):S.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,mt,Rt,ee,pe.width,pe.height,re,pe.data):L.texSubImage2D(L.TEXTURE_2D,mt,Rt,ee,yt,pt,re,Oe,pe);y.pixelStorei(L.UNPACK_ROW_LENGTH,je),y.pixelStorei(L.UNPACK_IMAGE_HEIGHT,Jt),y.pixelStorei(L.UNPACK_SKIP_PIXELS,li),y.pixelStorei(L.UNPACK_SKIP_ROWS,Li),y.pixelStorei(L.UNPACK_SKIP_IMAGES,un),mt===0&&N.generateMipmaps&&L.generateMipmap(_t),y.unbindTexture()},this.initRenderTarget=function(S){W.get(S).__webglFramebuffer===void 0&&Z.setupRenderTarget(S)},this.initTexture=function(S){S.isCubeTexture?Z.setTextureCube(S,0):S.isData3DTexture?Z.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?Z.setTexture2DArray(S,0):Z.setTexture2D(S,0),y.unbindTexture()},this.resetState=function(){q=0,G=0,J=null,y.reset(),gt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Bi}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=$t._getDrawingBufferColorSpace(t),e.unpackColorSpace=$t._getUnpackColorSpace()}}const Tu={type:"change"},oc={type:"start"},Mf={type:"end"},Ma=new sc,Au=new En,Dy=Math.cos(70*Ah.DEG2RAD),Ee=new U,Je=2*Math.PI,ne={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},ll=1e-6;class Iy extends df{constructor(t,e=null){super(t,e),this.state=ne.NONE,this.target=new U,this.cursor=new U,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:qs.ROTATE,MIDDLE:qs.DOLLY,RIGHT:qs.PAN},this.touches={ONE:Ws.ROTATE,TWO:Ws.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle="auto",this._domElementKeyEvents=null,this._lastPosition=new U,this._lastQuaternion=new In,this._lastTargetPosition=new U,this._quat=new In().setFromUnitVectors(t.up,new U(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new iu,this._sphericalDelta=new iu,this._scale=1,this._panOffset=new U,this._rotateStart=new Nt,this._rotateEnd=new Nt,this._rotateDelta=new Nt,this._panStart=new Nt,this._panEnd=new Nt,this._panDelta=new Nt,this._dollyStart=new Nt,this._dollyEnd=new Nt,this._dollyDelta=new Nt,this._dollyDirection=new U,this._mouse=new Nt,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Ny.bind(this),this._onPointerDown=Ly.bind(this),this._onPointerUp=Fy.bind(this),this._onContextMenu=Gy.bind(this),this._onMouseWheel=Oy.bind(this),this._onKeyDown=ky.bind(this),this._onTouchStart=By.bind(this),this._onTouchMove=Vy.bind(this),this._onMouseDown=Uy.bind(this),this._onMouseMove=zy.bind(this),this._interceptControlDown=Hy.bind(this),this._interceptControlUp=Wy.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(t){this._cursorStyle=t,t==="grab"?this.domElement.style.cursor="grab":this.domElement.style.cursor="auto"}get cursorStyle(){return this._cursorStyle}connect(t){super.connect(t),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction=""}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(t){t.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=t}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(Tu),this.update(),this.state=ne.NONE}pan(t,e){this._pan(t,e),this.update()}dollyIn(t){this._dollyIn(t),this.update()}dollyOut(t){this._dollyOut(t),this.update()}rotateLeft(t){this._rotateLeft(t),this.update()}rotateUp(t){this._rotateUp(t),this.update()}update(t=null){const e=this.object.position;Ee.copy(e).sub(this.target),Ee.applyQuaternion(this._quat),this._spherical.setFromVector3(Ee),this.autoRotate&&this.state===ne.NONE&&this._rotateLeft(this._getAutoRotationAngle(t)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let i=this.minAzimuthAngle,n=this.maxAzimuthAngle;isFinite(i)&&isFinite(n)&&(i<-Math.PI?i+=Je:i>Math.PI&&(i-=Je),n<-Math.PI?n+=Je:n>Math.PI&&(n-=Je),i<=n?this._spherical.theta=Math.max(i,Math.min(n,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(i+n)/2?Math.max(i,this._spherical.theta):Math.min(n,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let s=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const a=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),s=a!=this._spherical.radius}if(Ee.setFromSpherical(this._spherical),Ee.applyQuaternion(this._quatInverse),e.copy(this.target).add(Ee),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let a=null;if(this.object.isPerspectiveCamera){const o=Ee.length();a=this._clampDistance(o*this._scale);const l=o-a;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),s=!!l}else if(this.object.isOrthographicCamera){const o=new U(this._mouse.x,this._mouse.y,0);o.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),s=l!==this.object.zoom;const h=new U(this._mouse.x,this._mouse.y,0);h.unproject(this.object),this.object.position.sub(h).add(o),this.object.updateMatrixWorld(),a=Ee.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;a!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(a).add(this.object.position):(Ma.origin.copy(this.object.position),Ma.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(Ma.direction))<Dy?this.object.lookAt(this.target):(Au.setFromNormalAndCoplanarPoint(this.object.up,this.target),Ma.intersectPlane(Au,this.target))))}else if(this.object.isOrthographicCamera){const a=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),a!==this.object.zoom&&(this.object.updateProjectionMatrix(),s=!0)}return this._scale=1,this._performCursorZoom=!1,s||this._lastPosition.distanceToSquared(this.object.position)>ll||8*(1-this._lastQuaternion.dot(this.object.quaternion))>ll||this._lastTargetPosition.distanceToSquared(this.target)>ll?(this.dispatchEvent(Tu),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(t){return t!==null?Je/60*this.autoRotateSpeed*t:Je/60/60*this.autoRotateSpeed}_getZoomScale(t){const e=Math.abs(t*.01);return Math.pow(.95,this.zoomSpeed*e)}_rotateLeft(t){this._sphericalDelta.theta-=t}_rotateUp(t){this._sphericalDelta.phi-=t}_panLeft(t,e){Ee.setFromMatrixColumn(e,0),Ee.multiplyScalar(-t),this._panOffset.add(Ee)}_panUp(t,e){this.screenSpacePanning===!0?Ee.setFromMatrixColumn(e,1):(Ee.setFromMatrixColumn(e,0),Ee.crossVectors(this.object.up,Ee)),Ee.multiplyScalar(t),this._panOffset.add(Ee)}_pan(t,e){const i=this.domElement;if(this.object.isPerspectiveCamera){const n=this.object.position;Ee.copy(n).sub(this.target);let s=Ee.length();s*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*t*s/i.clientHeight,this.object.matrix),this._panUp(2*e*s/i.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(t*(this.object.right-this.object.left)/this.object.zoom/i.clientWidth,this.object.matrix),this._panUp(e*(this.object.top-this.object.bottom)/this.object.zoom/i.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(t,e){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const i=this.domElement.getBoundingClientRect(),n=t-i.left,s=e-i.top,a=i.width,o=i.height;this._mouse.x=n/a*2-1,this._mouse.y=-(s/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(t){return Math.max(this.minDistance,Math.min(this.maxDistance,t))}_handleMouseDownRotate(t){this._rotateStart.set(t.clientX,t.clientY)}_handleMouseDownDolly(t){this._updateZoomParameters(t.clientX,t.clientX),this._dollyStart.set(t.clientX,t.clientY)}_handleMouseDownPan(t){this._panStart.set(t.clientX,t.clientY)}_handleMouseMoveRotate(t){this._rotateEnd.set(t.clientX,t.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Je*this._rotateDelta.x/e.clientHeight),this._rotateUp(Je*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(t){this._dollyEnd.set(t.clientX,t.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(t){this._panEnd.set(t.clientX,t.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(t){this._updateZoomParameters(t.clientX,t.clientY),t.deltaY<0?this._dollyIn(this._getZoomScale(t.deltaY)):t.deltaY>0&&this._dollyOut(this._getZoomScale(t.deltaY)),this.update()}_handleKeyDown(t){let e=!1;switch(t.code){case this.keys.UP:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(Je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),e=!0;break;case this.keys.BOTTOM:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(-Je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),e=!0;break;case this.keys.LEFT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(Je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),e=!0;break;case this.keys.RIGHT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(-Je*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),e=!0;break}e&&(t.preventDefault(),this.update())}_handleTouchStartRotate(t){if(this._pointers.length===1)this._rotateStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._rotateStart.set(i,n)}}_handleTouchStartPan(t){if(this._pointers.length===1)this._panStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._panStart.set(i,n)}}_handleTouchStartDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,n=t.pageY-e.y,s=Math.sqrt(i*i+n*n);this._dollyStart.set(0,s)}_handleTouchStartDollyPan(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enablePan&&this._handleTouchStartPan(t)}_handleTouchStartDollyRotate(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enableRotate&&this._handleTouchStartRotate(t)}_handleTouchMoveRotate(t){if(this._pointers.length==1)this._rotateEnd.set(t.pageX,t.pageY);else{const i=this._getSecondPointerPosition(t),n=.5*(t.pageX+i.x),s=.5*(t.pageY+i.y);this._rotateEnd.set(n,s)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Je*this._rotateDelta.x/e.clientHeight),this._rotateUp(Je*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(t){if(this._pointers.length===1)this._panEnd.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._panEnd.set(i,n)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,n=t.pageY-e.y,s=Math.sqrt(i*i+n*n);this._dollyEnd.set(0,s),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const a=(t.pageX+e.x)*.5,o=(t.pageY+e.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enablePan&&this._handleTouchMovePan(t)}_handleTouchMoveDollyRotate(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enableRotate&&this._handleTouchMoveRotate(t)}_addPointer(t){this._pointers.push(t.pointerId)}_removePointer(t){delete this._pointerPositions[t.pointerId];for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId){this._pointers.splice(e,1);return}}_isTrackingPointer(t){for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId)return!0;return!1}_trackPointer(t){let e=this._pointerPositions[t.pointerId];e===void 0&&(e=new Nt,this._pointerPositions[t.pointerId]=e),e.set(t.pageX,t.pageY)}_getSecondPointerPosition(t){const e=t.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[e]}_customWheelEvent(t){const e=t.deltaMode,i={clientX:t.clientX,clientY:t.clientY,deltaY:t.deltaY};switch(e){case 1:i.deltaY*=16;break;case 2:i.deltaY*=100;break}return t.ctrlKey&&!this._controlActive&&(i.deltaY*=10),i}}function Ly(r){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(r.pointerId),this.domElement.ownerDocument.addEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(r)&&(this._addPointer(r),r.pointerType==="touch"?this._onTouchStart(r):this._onMouseDown(r),this._cursorStyle==="grab"&&(this.domElement.style.cursor="grabbing")))}function Ny(r){this.enabled!==!1&&(r.pointerType==="touch"?this._onTouchMove(r):this._onMouseMove(r))}function Fy(r){switch(this._removePointer(r),this._pointers.length){case 0:this.domElement.releasePointerCapture(r.pointerId),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(Mf),this.state=ne.NONE,this._cursorStyle==="grab"&&(this.domElement.style.cursor="grab");break;case 1:const t=this._pointers[0],e=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:e.x,pageY:e.y});break}}function Uy(r){let t;switch(r.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case qs.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(r),this.state=ne.DOLLY;break;case qs.ROTATE:if(r.ctrlKey||r.metaKey||r.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(r),this.state=ne.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(r),this.state=ne.ROTATE}break;case qs.PAN:if(r.ctrlKey||r.metaKey||r.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(r),this.state=ne.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(r),this.state=ne.PAN}break;default:this.state=ne.NONE}this.state!==ne.NONE&&this.dispatchEvent(oc)}function zy(r){switch(this.state){case ne.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(r);break;case ne.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(r);break;case ne.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(r);break}}function Oy(r){this.enabled===!1||this.enableZoom===!1||this.state!==ne.NONE||(r.preventDefault(),this.dispatchEvent(oc),this._handleMouseWheel(this._customWheelEvent(r)),this.dispatchEvent(Mf))}function ky(r){this.enabled!==!1&&this._handleKeyDown(r)}function By(r){switch(this._trackPointer(r),this._pointers.length){case 1:switch(this.touches.ONE){case Ws.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(r),this.state=ne.TOUCH_ROTATE;break;case Ws.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(r),this.state=ne.TOUCH_PAN;break;default:this.state=ne.NONE}break;case 2:switch(this.touches.TWO){case Ws.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(r),this.state=ne.TOUCH_DOLLY_PAN;break;case Ws.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(r),this.state=ne.TOUCH_DOLLY_ROTATE;break;default:this.state=ne.NONE}break;default:this.state=ne.NONE}this.state!==ne.NONE&&this.dispatchEvent(oc)}function Vy(r){switch(this._trackPointer(r),this.state){case ne.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(r),this.update();break;case ne.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(r),this.update();break;case ne.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(r),this.update();break;case ne.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(r),this.update();break;default:this.state=ne.NONE}}function Gy(r){this.enabled!==!1&&r.preventDefault()}function Hy(r){r.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function Wy(r){r.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}const ys=new Ln(0,0,0,"YXZ"),vs=new U,Xy={type:"change"},qy={type:"lock"},$y={type:"unlock"},Ru=.002,Cu=Math.PI/2;class Yy extends df{constructor(t,e=null){super(t,e),this.isLocked=!1,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.pointerSpeed=1,this._onMouseMove=Zy.bind(this),this._onPointerlockChange=Ky.bind(this),this._onPointerlockError=Jy.bind(this),this.domElement!==null&&this.connect(this.domElement)}connect(t){super.connect(t),this.domElement.ownerDocument.addEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.addEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.addEventListener("pointerlockerror",this._onPointerlockError)}disconnect(){this.domElement.ownerDocument.removeEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.removeEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.removeEventListener("pointerlockerror",this._onPointerlockError)}dispose(){this.disconnect()}getDirection(t){return t.set(0,0,-1).applyQuaternion(this.object.quaternion)}moveForward(t){if(this.enabled===!1)return;const e=this.object;vs.setFromMatrixColumn(e.matrix,0),vs.crossVectors(e.up,vs),e.position.addScaledVector(vs,t)}moveRight(t){if(this.enabled===!1)return;const e=this.object;vs.setFromMatrixColumn(e.matrix,0),e.position.addScaledVector(vs,t)}lock(t=!1){this.domElement.requestPointerLock({unadjustedMovement:t})}unlock(){this.domElement.ownerDocument.exitPointerLock()}}function Zy(r){if(this.enabled===!1||this.isLocked===!1)return;const t=this.object;ys.setFromQuaternion(t.quaternion),ys.y-=r.movementX*Ru*this.pointerSpeed,ys.x-=r.movementY*Ru*this.pointerSpeed,ys.x=Math.max(Cu-this.maxPolarAngle,Math.min(Cu-this.minPolarAngle,ys.x)),t.quaternion.setFromEuler(ys),this.dispatchEvent(Xy)}function Ky(){this.domElement.ownerDocument.pointerLockElement===this.domElement?(this.dispatchEvent(qy),this.isLocked=!0):(this.dispatchEvent($y),this.isLocked=!1)}function Jy(){console.error("THREE.PointerLockControls: Unable to use Pointer Lock API")}class Qy extends io{constructor(){super(),this.name="RoomEnvironment",this.position.y=-3.5;const t=new es;t.deleteAttribute("uv");const e=new Zc({side:Ue}),i=new Zc,n=new Pm(16777215,900,28,2);n.position.set(.418,16.199,.3),this.add(n);const s=new Se(t,e);s.position.set(-.757,13.219,.717),s.scale.set(31.713,28.305,28.591),this.add(s);const a=new pm(t,i,6),o=new Pi;o.position.set(-10.906,2.009,1.846),o.rotation.set(0,-.195,0),o.scale.set(2.328,7.905,4.651),o.updateMatrix(),a.setMatrixAt(0,o.matrix),o.position.set(-5.607,-.754,-.758),o.rotation.set(0,.994,0),o.scale.set(1.97,1.534,3.955),o.updateMatrix(),a.setMatrixAt(1,o.matrix),o.position.set(6.167,.857,7.803),o.rotation.set(0,.561,0),o.scale.set(3.927,6.285,3.687),o.updateMatrix(),a.setMatrixAt(2,o.matrix),o.position.set(-2.017,.018,6.124),o.rotation.set(0,.333,0),o.scale.set(2.002,4.566,2.064),o.updateMatrix(),a.setMatrixAt(3,o.matrix),o.position.set(2.291,-.756,-2.621),o.rotation.set(0,-.286,0),o.scale.set(1.546,1.552,1.496),o.updateMatrix(),a.setMatrixAt(4,o.matrix),o.position.set(-2.193,-.369,-5.547),o.rotation.set(0,.516,0),o.scale.set(3.875,3.487,2.986),o.updateMatrix(),a.setMatrixAt(5,o.matrix),this.add(a);const l=new Se(t,Ms(50));l.position.set(-16.116,14.37,8.208),l.scale.set(.1,2.428,2.739),this.add(l);const h=new Se(t,Ms(50));h.position.set(-16.109,18.021,-8.207),h.scale.set(.1,2.425,2.751),this.add(h);const c=new Se(t,Ms(17));c.position.set(14.904,12.198,-1.832),c.scale.set(.15,4.265,6.331),this.add(c);const d=new Se(t,Ms(43));d.position.set(-.462,8.89,14.52),d.scale.set(4.38,5.441,.088),this.add(d);const u=new Se(t,Ms(20));u.position.set(3.235,11.486,-12.541),u.scale.set(2.5,2,.1),this.add(u);const f=new Se(t,Ms(100));f.position.set(0,20,0),f.scale.set(1,.1,1),this.add(f)}dispose(){const t=new Set;this.traverse(e=>{e.isMesh&&(t.add(e.geometry),t.add(e.material))});for(const e of t)e.dispose()}}function Ms(r){return new wm({color:0,emissive:16777215,emissiveIntensity:r})}class Xr extends Se{constructor(){const t=Xr.SkyShader,e=new gi({name:t.name,uniforms:hf.clone(t.uniforms),vertexShader:t.vertexShader,fragmentShader:t.fragmentShader,side:Ue,depthWrite:!1});super(new es(1,1,1),e),this.isSky=!0}}Xr.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new U},up:{value:new U(0,1,0)},cloudScale:{value:2e-4},cloudSpeed:{value:1e-4},cloudCoverage:{value:.4},cloudDensity:{value:.4},cloudElevation:{value:.5},showSunDisc:{value:1},time:{value:0}},vertexShader:`
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

		}`};const jy=`
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
`;function Pu(r={}){const t=Number(r.radius??4e3),e=Du(r.sunDirection,[.35,.22,-1]).normalize(),i={uZenith:{value:new Ft(r.zenith??2781124)},uHorizon:{value:new Ft(r.horizon??12376046)},uGround:{value:new Ft(r.ground??7038296)},uSunColor:{value:new Ft(r.sunColor??16773840)},uCloudColor:{value:new Ft(r.cloudColor??16777215)},uCloudShadow:{value:new Ft(r.cloudShadow??9083824)},uSunDirection:{value:e.clone()},uSunSize:{value:Number(r.sunSize??.004)},uSunGlow:{value:Number(r.sunGlow??220)},uCloudCoverage:{value:Number(r.cloudCoverage??.48)},uCloudOpacity:{value:Number(r.cloudOpacity??.9)},uCloudScale:{value:Number(r.cloudScale??1.6)},uCloudSpeed:{value:Number(r.cloudSpeed??.006)},uWindOffset:{value:new Nt},uWindDriven:{value:0},uHaze:{value:Number(r.haze??.35)},uTime:{value:0}},n=new gi({uniforms:i,side:Ue,depthWrite:!1,depthTest:!1,vertexShader:`
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
      ${jy}
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
    `}),s=new Se(new ym(t,48,32),n);return s.name="A3GameSkyGradient",s.frustumCulled=!1,s.renderOrder=-1e3,s.onBeforeRender=(a,o,l)=>{l.getWorldPosition(s.position),s.parent&&s.parent.worldToLocal(s.position),s.updateMatrixWorld(!0)},s.userData.update=(a,o=r.windField)=>{if(i.uTime.value+=Number(a)||0,o){const l=i.uCloudScale.value/Math.max(1,Number(r.cloudHeight??120));i.uWindOffset.value.set(-o.displacement.x*l,-o.displacement.z*l),i.uWindDriven.value=1}},s.userData.setSunDirection=a=>{i.uSunDirection.value.copy(Du(a,[.35,.22,-1])).normalize()},s.userData.uniforms=i,s}function Du(r,t=[0,0,0]){return r?.isVector3?r.clone():Array.isArray(r)&&r.length>=3?new U(Number(r[0]),Number(r[1]),Number(r[2])):r&&typeof r=="object"&&"x"in r?new U(Number(r.x??0),Number(r.y??0),Number(r.z??0)):new U(t[0],t[1],t[2])}const tv=(r=[0,0,0])=>{const t=Array.isArray(r)?r:[r.x,r.y,r.z];if(t.length!==3||!t.every(e=>Number.isFinite(Number(e))))throw new TypeError("Wind velocity must contain three finite numbers in metres/second");return new U(...t.map(Number))},bs=(r,t,e=0)=>{const i=Number(r??t);if(!Number.isFinite(i)||i<e)throw new RangeError("Invalid wind parameter");return i};class ev{constructor(t={}){this.velocity=new U,this.targetVelocity=new U,this.displacement=new U,this.elapsedSeconds=0,this.set(t,!0)}set(t={},e=!1){const i=t.velocity===void 0?this.targetVelocity.clone():tv(t.velocity),n=bs(t.gustStrength,this.gustStrength??0),s=bs(t.gustPeriod,this.gustPeriod??6,.1),a=bs(t.spatialScale,this.spatialScale??30,.1),o=bs(t.response,this.response??1.5,.01),l=bs(t.heightShear,this.heightShear??.05),h=bs(t.seed,this.seed??1,-Number.MAX_SAFE_INTEGER);return Object.assign(this,{gustStrength:n,gustPeriod:s,spatialScale:a,response:o,heightShear:l,seed:h}),this.targetVelocity.copy(i),e&&this.velocity.copy(i),this}sample(t,e=this.elapsedSeconds,i=new U){const n=Number(e);if(!Number.isFinite(n))throw new RangeError("Wind time must be finite");const s=t?.x??0,a=t?.y??0,o=t?.z??0,l=this.seed%1e4*.61803398875,h=2*Math.PI/this.gustPeriod,c=Math.sin(n*h+s/this.spatialScale+l),d=Math.sin(n*h*.63-o/this.spatialScale+l*2.1),u=1+this.heightShear*Math.log1p(Math.max(0,a)/10);i.copy(this.velocity).multiplyScalar(u);const f=Math.hypot(this.velocity.x,this.velocity.z),p=f>1e-9?this.velocity.x/f:1,x=f>1e-9?this.velocity.z/f:0;return i.x+=this.gustStrength*(p*c-x*d*.25),i.z+=this.gustStrength*(x*c+p*d*.25),i}update(t){if(!Number.isFinite(t)||t<0)throw new RangeError("Wind dt must be finite and non-negative");if(t===0)return this;const e=this.sample(null,this.elapsedSeconds);this.velocity.lerp(this.targetVelocity,1-Math.exp(-t/this.response)),this.elapsedSeconds+=t;const i=this.sample(null,this.elapsedSeconds);return this.displacement.addScaledVector(e.add(i),t*.5),this}getState(){return{velocity:this.velocity.toArray(),targetVelocity:this.targetVelocity.toArray(),gustStrength:this.gustStrength,gustPeriod:this.gustPeriod,spatialScale:this.spatialScale,elapsedSeconds:this.elapsedSeconds,displacement:this.displacement.toArray(),seed:this.seed}}}const Vn=Object.freeze({ROOM:"room",SKY:"sky",GRADIENT:"gradient",NONE:"none"}),hl=Object.freeze({NoToneMapping:Ti,LinearToneMapping:kh,ReinhardToneMapping:Bh,CineonToneMapping:Vh,ACESFilmicToneMapping:Gh,AgXToneMapping:Hh,NeutralToneMapping:Mo}),Iu=r=>r?typeof r=="string"?document.querySelector(r):r:null;class iv{constructor(t={}){this.options={antialias:!0,shadows:!0,pixelRatioCap:2,clearColor:1052692,toneMapping:"NeutralToneMapping",toneMappingExposure:1,cameraType:"perspective",frustumHeight:12,fov:50,near:.1,far:2e3,fixedTimeStep:1/60,maxSubSteps:6,maxFrameDelta:.1,environmentUpdateInterval:0,...t};for(const e of["fixedTimeStep","maxFrameDelta","environmentUpdateInterval"]){const i=Number(this.options[e]);if(!Number.isFinite(i)||i<0||e==="maxFrameDelta"&&i===0)throw new RangeError(`${e} must be finite and ${e==="maxFrameDelta"?"positive":"non-negative"}`);this.options[e]=i}if(!Number.isInteger(this.options.maxSubSteps)||this.options.maxSubSteps<1)throw new RangeError("maxSubSteps must be a positive integer");this.container=Iu(t.container),this.hudContainer=Iu(t.hudContainer),this.renderer=null,this.scene=null,this.camera=null,this.controls=null,this.generatedEnvironment=null,this.skyDome=null,this.sunDirection=new U(.35,.22,-1).normalize(),this.wind=new ev(t.wind??{}),this.clock=new Nm,this.raycaster=new Lm,this.pointer=new Nt,this.frameHandle=null,this.running=!1,this.frameCount=0,this.elapsedSeconds=0,this.accumulator=0,this.interpolationAlpha=0,this.droppedSeconds=0,this.lastSubSteps=0,this.renderListeners=new Set,this.interpolatedObjects=new Map,this.sunLights=new Map,this.sunConfigured=!1,this.environmentPresetOptions=null,this.environmentAge=0,this.generatedEnvironmentTarget=null,this.tickListeners=new Set,this.resizeListeners=new Set,this.namedRoots=new Map,this.resizeObserver=null,this.onWindowResize=null}async init(){if(!this.container)throw new Error("A3GameRuntimeHost requires an existing container element");const{clientWidth:t,clientHeight:e}=this.#l();return this.renderer=new Py({antialias:this.options.antialias,alpha:!1,powerPreference:"high-performance",preserveDrawingBuffer:!0}),this.renderer.outputColorSpace=si,this.renderer.setClearColor(new Ft(this.options.clearColor)),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,this.options.pixelRatioCap)),this.renderer.setSize(t,e),this.renderer.toneMapping=hl[this.options.toneMapping]??Mo,this.renderer.toneMappingExposure=this.options.toneMappingExposure,this.renderer.shadowMap.enabled=!!this.options.shadows,this.renderer.shadowMap.type=Nd,this.container.appendChild(this.renderer.domElement),this.scene=new io,this.scene.name="A3GameWorld",this.camera=this.#c(this.options.cameraType,t/Math.max(1,e)),this.camera.name="A3GameCamera",this.camera.position.set(0,2,8),this.camera.lookAt(0,1,0),this.#f(),this}usePerspectiveCamera(t={}){return Object.assign(this.options,{cameraType:"perspective",fov:Number(t.fov??this.options.fov),near:Number(t.near??this.options.near),far:Number(t.far??this.options.far)}),this.#h("perspective")}useOrthographicCamera(t={}){return Object.assign(this.options,{cameraType:"orthographic",frustumHeight:Math.max(.01,Number(t.frustumHeight??this.options.frustumHeight)),near:Number(t.near??-this.options.far),far:Number(t.far??this.options.far)}),this.#h("orthographic")}start(){if(this.running)return this;if(!this.renderer||!this.scene||!this.camera)throw new Error("A3GameRuntimeHost.init() must run before start()");this.running=!0,this.clock.start();const t=()=>{this.running&&(this.frameHandle=requestAnimationFrame(t),this.tick())};return this.frameHandle=requestAnimationFrame(t),this}stop(){return this.running=!1,this.frameHandle!==null&&(cancelAnimationFrame(this.frameHandle),this.frameHandle=null),this}tick(t){const e=t===void 0?this.clock.getDelta():Number(t);if(!Number.isFinite(e)||e<0)throw new RangeError("tick delta must be finite and non-negative");const i=Math.min(e,this.options.maxFrameDelta);this.droppedSeconds+=e-i,this.frameCount+=1,this.lastSubSteps=0;const n=this.options.fixedTimeStep;if(n>0){for(this.accumulator+=i;this.accumulator+n*1e-9>=n&&this.lastSubSteps<this.options.maxSubSteps;)this.#t(n),this.accumulator=Math.max(0,this.accumulator-n),this.lastSubSteps+=1;if(this.accumulator>=n){const s=Math.floor(this.accumulator/n)*n;this.droppedSeconds+=s,this.accumulator-=s}this.interpolationAlpha=this.accumulator/n}else this.#t(i),this.lastSubSteps=1,this.interpolationAlpha=1;return this.#i(i),this}#t(t){for(const[i,n]of this.interpolatedObjects)n.position.copy(i.position),n.quaternion.copy(i.quaternion),n.scale.copy(i.scale);this.elapsedSeconds+=t,this.#u(t),this.environmentAge+=t;const e=this.options.environmentUpdateInterval;e>0&&this.environmentAge>=e&&this.generatedEnvironment&&this.refreshEnvironment()}#i(t){const e=[];try{for(const[i,n]of this.interpolatedObjects){const s=n.current;s.position.copy(i.position),s.quaternion.copy(i.quaternion),s.scale.copy(i.scale),e.push([i,s]),i.position.lerpVectors(n.position,s.position,this.interpolationAlpha),i.quaternion.slerpQuaternions(n.quaternion,s.quaternion,this.interpolationAlpha),i.scale.lerpVectors(n.scale,s.scale,this.interpolationAlpha),i.updateMatrixWorld(!0)}for(const i of this.renderListeners)i(t,this.interpolationAlpha);this.controls?.update?.(t),this.renderer?.render(this.scene,this.camera)}finally{for(const[i,n]of e)i.position.copy(n.position),i.quaternion.copy(n.quaternion),i.scale.copy(n.scale),i.updateMatrixWorld(!0)}}onRender(t){if(typeof t!="function")throw new TypeError("onRender requires a function");return this.renderListeners.add(t),()=>this.renderListeners.delete(t)}interpolateObject(t){if(!t?.isObject3D)throw new TypeError("interpolateObject requires an Object3D");const e=()=>({position:t.position.clone(),quaternion:t.quaternion.clone(),scale:t.scale.clone()});return this.interpolatedObjects.set(t,{...e(),current:e()}),()=>this.interpolatedObjects.delete(t)}resetInterpolation(t){return this.interpolatedObjects.has(t)&&this.interpolateObject(t),this}onTick(t){if(typeof t!="function")throw new TypeError("onTick requires a function");return this.tickListeners.add(t),()=>this.tickListeners.delete(t)}onResize(t){if(typeof t!="function")throw new TypeError("onResize requires a function");return this.resizeListeners.add(t),()=>this.resizeListeners.delete(t)}add(t,e="entities"){if(!this.scene)throw new Error("init() must run before add()");let i=this.namedRoots.get(e);return i||(i=new Xs,i.name=`A3Game_${e}`,this.scene.add(i),this.namedRoots.set(e,i)),i.add(t),t.traverse(n=>{n.isDirectionalLight&&n.userData.a3gameSun&&this.registerSunLight(n)}),t}remove(t){return t?.traverse?.(e=>{this.sunLights.delete(e),this.interpolatedObjects.delete(e)}),t?.parent?.remove(t),this}registerSunLight(t,e){if(!t?.isDirectionalLight)throw new TypeError("Sun must be a DirectionalLight");t.updateWorldMatrix(!0,!1),t.target.updateWorldMatrix(!0,!1);const i=e??t.getWorldPosition(new U).distanceTo(t.target.getWorldPosition(new U));if(!Number.isFinite(i)||i<=0)throw new RangeError("Sun distance must be positive");return this.sunLights.set(t,i),!t.target.parent&&this.scene&&this.scene.add(t.target),this.sunConfigured&&this.#s(),()=>this.sunLights.delete(t)}#s(){this.skyDome?.userData?.setSunDirection?.(this.sunDirection),this.skyDome?.material?.uniforms?.sunPosition?.value.copy(this.sunDirection);for(const[t,e]of this.sunLights){const i=t.target.getWorldPosition(new U).addScaledVector(this.sunDirection,e);t.parent&&t.parent.worldToLocal(i),t.position.copy(i),t.updateMatrixWorld(!0)}}refreshEnvironment(){return this.generatedEnvironment&&this.environmentPresetOptions&&this.#n(this.environmentPresetOptions,!0),this.environmentAge=0,this}getRoot(t="entities"){return this.namedRoots.has(t)||this.add(new Xs,t),this.namedRoots.get(t)}attachOrbitControls(t={}){this.detachControls();const e=new Iy(this.camera,this.renderer.domElement);e.enableDamping=t.enableDamping!==!1,e.dampingFactor=.08,e.screenSpacePanning=!1,t.maxPolarAngle!==void 0&&(e.maxPolarAngle=t.maxPolarAngle),t.minDistance!==void 0&&(e.minDistance=t.minDistance),t.maxDistance!==void 0&&(e.maxDistance=t.maxDistance);const i=t.target??{x:0,y:1,z:0};return e.target.set(i.x,i.y,i.z),e.update(),this.controls=e,e}attachPointerLockControls(){this.detachControls();const t=new Yy(this.camera,this.container);return this.controls=t,t}async requestPointerLock(){const t=this.container;if(!t?.requestPointerLock)return!1;try{const e=t.requestPointerLock({unadjustedMovement:!0});return e&&typeof e.then=="function"&&await e,!0}catch{try{return t.requestPointerLock(),!0}catch{return!1}}}exitPointerLock(){return document.pointerLockElement&&document.exitPointerLock?.(),this}isPointerLocked(){return document.pointerLockElement===this.container}setFrustumHeight(t){const e=Math.max(.01,Number(t)||0);return e===this.options.frustumHeight?this:(this.options.frustumHeight=e,this.camera?.isOrthographicCamera&&this.#d(),this)}detachControls(){return this.controls&&typeof this.controls.dispose=="function"&&this.controls.dispose(),this.controls=null,this}setWind(t,e=!1){return this.wind.set(t,e),this}setEnvironment(t={}){if(!this.scene)throw new Error("init() must run before setEnvironment()");t.wind&&this.setWind(t.wind);let e=!1;if(t.sunPosition){const i=new U(Number(t.sunPosition.x??0),Number(t.sunPosition.y??1),Number(t.sunPosition.z??0));if(!i.toArray().every(Number.isFinite)||i.lengthSq()<1e-12)throw new RangeError("sunPosition must be a finite non-zero direction");i.normalize(),e=this.sunDirection.distanceToSquared(i)>1e-12,this.sunDirection.copy(i),this.sunConfigured=!0}return t.preset!==void 0?(this.environmentPresetOptions={...t,sunPosition:this.sunDirection.clone()},this.#n(this.environmentPresetOptions),this.sunConfigured=!0):e&&this.environmentPresetOptions&&(this.environmentPresetOptions.sunPosition=this.sunDirection.clone(),t.environmentTexture||this.refreshEnvironment()),this.sunConfigured&&this.#s(),t.background!==void 0&&(this.scene.background=t.background===null?null:new Ft(t.background)),t.environmentTexture&&(t.environmentTexture.mapping=Lr,this.#r(),this.scene.environment=t.environmentTexture),t.backgroundTexture&&(t.backgroundTexture.mapping=Lr,this.#o(),this.scene.background=t.backgroundTexture),t.environmentIntensity!==void 0&&(this.scene.environmentIntensity=Number(t.environmentIntensity)),t.backgroundIntensity!==void 0&&(this.scene.backgroundIntensity=Number(t.backgroundIntensity)),t.backgroundBlurriness!==void 0&&(this.scene.backgroundBlurriness=Number(t.backgroundBlurriness)),t.backgroundRotationDegrees!==void 0&&this.scene.backgroundRotation.set(0,Ah.degToRad(Number(t.backgroundRotationDegrees)),0),t.environmentRotationDegrees!==void 0&&this.scene.environmentRotation.set(0,Ah.degToRad(Number(t.environmentRotationDegrees)),0),t.toneMapping&&Object.hasOwn(hl,t.toneMapping)&&(this.options.toneMapping=t.toneMapping,this.renderer&&(this.renderer.toneMapping=hl[t.toneMapping])),t.toneMappingExposure!==void 0&&(this.options.toneMappingExposure=Number(t.toneMappingExposure),this.renderer&&(this.renderer.toneMappingExposure=this.options.toneMappingExposure)),this}getSunDirection(){return this.sunDirection.clone()}getSunPosition(t=100){return this.sunDirection.clone().multiplyScalar(Number(t)||1)}#n(t,e=!1){const i=String(t.preset??"none").toLowerCase(),n=this.skyDome?.userData?.uniforms?.uTime?.value??0;if(i===Vn.NONE){this.#r(),this.#o(),this.scene.environment=null,this.environmentPresetOptions=null;return}if(!this.renderer)throw new Error("init() must run before an environment preset is set");const s=new Ph(this.renderer);let a=null,o=null;const l=i===Vn.SKY||i===Vn.GRADIENT;try{if(i===Vn.SKY){o=new Xr,o.scale.setScalar(this.options.far*.9);const d=t.sunPosition??{x:.4,y:.22,z:-1},u=new U(d.x,d.y,d.z).normalize();this.sunDirection.copy(u),o.material.uniforms.sunPosition.value.copy(u),o.material.uniforms.turbidity.value=Number(t.turbidity??6),o.material.uniforms.rayleigh.value=Number(t.rayleigh??2),o.material.uniforms.mieCoefficient.value=Number(t.mieCoefficient??.005),o.material.uniforms.mieDirectionalG.value=Number(t.mieDirectionalG??.8),a=new io,a.add(o)}else if(i===Vn.GRADIENT){const d=Pu({...t.sky??{},radius:50,sunDirection:t.sunPosition??this.sunDirection});d.material.depthTest=!0,d.material.depthWrite=!0,d.material.toneMapped=!1,d.userData.uniforms.uTime.value=n,d.userData.update(0,this.wind),d.onBeforeRender=()=>{},a=new io,a.add(d)}else if(i===Vn.ROOM)a=new Qy;else throw new Error(`Unknown environment preset ${String(t.preset)}; expected room, sky, gradient, or none`);const h=s.fromScene(a,.04),c=this.scene.background===this.generatedEnvironment;this.#r(),this.generatedEnvironmentTarget=h,this.generatedEnvironment=h.texture,this.scene.environment=h.texture,this.environmentAge=0,this.scene.environmentRotation.set(0,0,0),e?c&&(this.scene.background=h.texture):l&&t.showSky!==!1?i===Vn.GRADIENT?(this.#a(t),this.skyDome.userData.uniforms.uTime.value=n):this.#e(t):(this.#o(),t.background===void 0&&(this.scene.background=h.texture))}finally{a?.traverse?.(h=>{h.geometry?.dispose?.();const c=Array.isArray(h.material)?h.material:h.material?[h.material]:[];for(const d of c)d.dispose?.()}),s.dispose()}}#a(t){this.#o();const e=Pu({...t.sky??{},radius:Number(t.sky?.radius??this.options.far*.92),sunDirection:t.sunPosition??this.sunDirection});return t.sunPosition&&this.sunDirection.set(Number(t.sunPosition.x??0),Number(t.sunPosition.y??1),Number(t.sunPosition.z??0)).normalize(),e.userData.setSunDirection(this.sunDirection),this.skyDome=e,this.add(e,"sky"),this.scene.background=null,e}#o(){const t=this.namedRoots.get("sky");t&&(Lu(t),this.namedRoots.delete("sky")),this.skyDome=null}#e(t){this.#o();const e=new Xr;e.scale.setScalar(this.options.far*.9);const i=t.sunPosition??{x:.4,y:.22,z:-1};return this.sunDirection.set(i.x,i.y,i.z).normalize(),e.material.uniforms.sunPosition.value.copy(this.sunDirection),e.material.uniforms.turbidity.value=Number(t.turbidity??6),e.material.uniforms.rayleigh.value=Number(t.rayleigh??2),e.material.uniforms.mieCoefficient.value=Number(t.mieCoefficient??.005),e.material.uniforms.mieDirectionalG.value=Number(t.mieDirectionalG??.8),e.name="A3GameSky",this.skyDome=e,this.add(e,"sky"),this.scene.background=null,e}#r(){this.generatedEnvironment&&(this.scene?.background===this.generatedEnvironment&&(this.scene.background=null),this.generatedEnvironmentTarget?this.generatedEnvironmentTarget.dispose():this.generatedEnvironment.dispose(),this.generatedEnvironmentTarget=null,this.generatedEnvironment=null)}setFog(t={}){if(!this.scene)throw new Error("init() must run before setFog()");const e=t.type??"none";if(e==="none")return this.scene.fog=null,this;const i=new Ft(t.color??1052692);return this.scene.fog=e==="FogExp2"?new ic(i,t.density??.001):new nc(i,t.near??1,t.far??200),this}raycastFromPointer(t,e){if(!this.renderer||!this.camera)return null;const i=this.renderer.domElement.getBoundingClientRect();this.pointer.x=(t.clientX-i.left)/i.width*2-1,this.pointer.y=-((t.clientY-i.top)/i.height)*2+1,this.raycaster.setFromCamera(this.pointer,this.camera);const n=this.raycaster.intersectObjects(e??this.scene.children,!0);return n.length>0?n[0]:null}raycast(t,e,i={}){return this.raycaster.set(t,e.clone().normalize()),this.raycaster.near=i.near??0,this.raycaster.far=i.far??1/0,this.raycaster.intersectObjects(i.targets??this.scene.children,!0)}captureFrame(){return this.#i(0),this.renderer?.domElement.toDataURL("image/png")??""}getStats(){const t=this.renderer?.info;return{frameCount:this.frameCount,elapsedSeconds:Number(this.elapsedSeconds.toFixed(3)),simulationSteps:this.lastSubSteps,interpolationAlpha:this.interpolationAlpha,droppedSeconds:this.droppedSeconds,drawCalls:t?.render?.calls??0,triangles:t?.render?.triangles??0,geometries:t?.memory?.geometries??0,textures:t?.memory?.textures??0,programs:t?.programs?.length??0,pixelRatio:this.renderer?.getPixelRatio()??0,size:this.#l()}}dispose(){this.stop(),this.detachControls(),this.tickListeners.clear(),this.renderListeners.clear(),this.interpolatedObjects.clear(),this.sunLights.clear(),this.environmentPresetOptions=null,this.resizeListeners.clear(),this.onWindowResize&&(window.removeEventListener("resize",this.onWindowResize),this.onWindowResize=null),this.resizeObserver?.disconnect(),this.resizeObserver=null,this.#r(),this.skyDome=null,this.scene&&Lu(this.scene),this.scene=null,this.namedRoots.clear(),this.renderer&&(this.renderer.dispose(),this.renderer.domElement.remove(),this.renderer=null),this.camera=null}#u(t){this.wind.update(t),this.skyDome?.userData?.update?.(t,this.wind);for(const e of this.tickListeners)e(t,this.elapsedSeconds)}#l(){const t=this.container?.clientWidth||globalThis.window?.innerWidth||1,e=this.container?.clientHeight||globalThis.window?.innerHeight||1;return{width:t,height:e,clientWidth:t,clientHeight:e}}#c(t,e){if(t==="orthographic"){const i=this.options.frustumHeight/2,n=i*e;return new ac(-n,n,i,-i,this.options.near,this.options.far)}return new ri(this.options.fov,e,this.options.near,this.options.far)}#h(t){if(!this.scene)throw new Error("init() must run before switching cameras");const{width:e,height:i}=this.#l(),n=this.camera,s=this.#c(t,e/Math.max(1,i));if(s.name=n?.name??"A3GameCamera",n){s.position.copy(n.position),s.quaternion.copy(n.quaternion);const a=n.parent;n.removeFromParent?.(),a&&a.add(s)}return this.camera=s,this.controls?.object&&(this.controls.object=s),this.#d(),s}#d(){const{width:t,height:e}=this.#l();if(!this.camera||!this.renderer)return{width:t,height:e};const i=t/Math.max(1,e);if(this.camera.isOrthographicCamera){const n=this.options.frustumHeight/2,s=n*i;this.camera.left=-s,this.camera.right=s,this.camera.top=n,this.camera.bottom=-n}else this.camera.aspect=i;return this.camera.updateProjectionMatrix(),this.renderer.setSize(t,e),{width:t,height:e}}#f(){const t=()=>{const e=this.#d();for(const i of this.resizeListeners)i(e)};this.onWindowResize=t,window.addEventListener("resize",t),typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(t),this.resizeObserver.observe(this.container)),t()}}function Lu(r){if(!r)return;const t=["map","normalMap","roughnessMap","metalnessMap","aoMap","emissiveMap","alphaMap","displacementMap","envMap","lightMap","clearcoatMap","sheenColorMap"],e=new Set,i=n=>{!n||e.has(n)||n.userData?.a3AssetLibraryOwned||(e.add(n),n.dispose?.())};r.traverse(n=>{if(n.userData?.dispose?.(),n.userData?.disposed)return;n.isLight&&n.dispose?.(),i(n.geometry);const s=Array.isArray(n.material)?n.material:n.material?[n.material]:[];for(const a of s){for(const o of t)i(a[o]);i(a)}}),r.parent?.remove(r),r.clear?.()}const Nu="a3game-hud-style",nv=`
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
`,sv=new Set(["top-left","top-center","top-right","center","bottom-left","bottom-center","bottom-right"]),rv=r=>r?typeof r=="string"?document.querySelector(r):r:null;class av{constructor(t={}){const e=rv(t.container);if(!e)throw new Error("A3GameHudLayer requires an existing container");this.container=e,this.root=document.createElement("div"),this.root.className="a3game-hud-root",this.root.dataset.a3gameHud="root",this.container.appendChild(this.root),this.widgets=new Map,this.slots=new Map,this.fadeTasks=new Map,this.#s()}addText(t,e={}){return this.#t(t,"text",e),this.setValue(t,e.value??""),this.widgets.get(String(t)).element}addBar(t,e={}){const i=this.#t(t,"bar",e);if(i.innerHTML="",e.label){const s=document.createElement("span");s.textContent=String(e.label),i.appendChild(s)}const n=document.createElement("div");return n.className="a3game-hud-bar",n.appendChild(document.createElement("i")),i.appendChild(n),this.setValue(t,Number(e.value??1)),i}addCrosshair(t="crosshair"){const e=this.#t(t,"crosshair",{anchor:"center"});return e.classList.add("a3game-hud-crosshair"),e}addPanel(t,e={}){return this.#t(t,"panel",e),this.setValue(t,e.value??""),this.widgets.get(String(t)).element}addBanner(t,e={}){const i=this.#t(t,"banner",{anchor:e.anchor??"center"});return this.setValue(t,e.value??""),this.setVisible(t,e.visible!==!1),i}setValue(t,e){const i=this.widgets.get(String(t));if(!i)return!1;const{element:n,kind:s}=i;if(s==="bar"){const a=Math.max(0,Math.min(1,Number(e)||0)),o=n.querySelector(".a3game-hud-bar > i");return o&&(o.style.width=`${(a*100).toFixed(1)}%`),n.dataset.a3gameValue=a.toFixed(4),!0}return(s==="text"||s==="panel"||s==="banner")&&(n.textContent=String(e??"")),n.dataset.a3gameValue=String(e??""),!0}setValues(t={}){for(const[e,i]of Object.entries(t))this.setValue(e,i);return this}setVisible(t,e){const i=String(t),n=this.widgets.get(i);return n?(this.fadeTasks.get(i)?.(),n.element.style.display=e?"":"none",n.element.style.opacity=e?"1":"0",n.element.style.pointerEvents="",n.element.dataset.a3gameVisible=e?"true":"false",n.element.dataset.a3gameFaded="false",!0):!1}remove(t){const e=String(t),i=this.widgets.get(e);return i?(this.fadeTasks.get(e)?.(),i.element.remove(),this.widgets.delete(e),!0):!1}autoHide(t,e={}){const i=String(t),n=this.widgets.get(i);if(!n)return()=>{};const s=Number(e.after??6),a=Number(e.fade??.8);if(![s,a].every(u=>Number.isFinite(u)&&u>=0))throw new RangeError("autoHide after/fade must be finite non-negative seconds");if(e.host&&typeof e.host.onRender!="function")throw new TypeError("autoHide host requires onRender");this.setVisible(i,!0),n.element.style.transition="none";let o=0,l=()=>{},h=!1;const c=()=>{h||(h=!0,l(),this.fadeTasks.get(i)===c&&this.fadeTasks.delete(i))},d=u=>{if(h)return;o+=Math.max(0,Number(u)||0);const f=o<s?1:a>0?Math.max(0,1-(o-s)/a):0;n.element.style.opacity=String(f),f<=1e-8&&(n.element.style.display="none",n.element.dataset.a3gameVisible="false",n.element.dataset.a3gameFaded="true",c())};if(this.fadeTasks.set(i,c),e.host)l=e.host.onRender(d);else{let u=performance.now();const f=setInterval(()=>{const p=performance.now();d((p-u)/1e3),u=p},16);l=()=>clearInterval(f)}return d(0),c}getState(){const t={};for(const[e,i]of this.widgets)t[e]={kind:i.kind,value:i.element.dataset.a3gameValue??"",visible:i.element.style.display!=="none"&&i.element.style.opacity!=="0",anchor:i.element.dataset.a3gameAnchor??""};return t}dispose(){for(const t of this.fadeTasks.values())t();this.fadeTasks.clear(),this.widgets.clear(),this.slots.clear(),this.root.remove()}#t(t,e,i){const n=String(t);this.remove(n);const s=sv.has(i.anchor)?i.anchor:"top-left",a=document.createElement("div");return a.className=`a3game-hud-widget ${i.className??""}`.trim(),a.dataset.a3gameWidget=n,a.dataset.a3gameKind=e,a.dataset.a3gameAnchor=s,this.#i(s).appendChild(a),this.widgets.set(n,{element:a,kind:e}),a}#i(t){const e=this.slots.get(t);if(e)return e;const i=document.createElement("div");return i.className="a3game-hud-slot",i.dataset.a3gameAnchor=t,this.root.appendChild(i),this.slots.set(t,i),i}#s(){if(document.getElementById(Nu))return;const t=document.createElement("style");t.id=Nu,t.textContent=nv,document.head.appendChild(t)}}const yr=(r,t)=>Number.isFinite(Number(r))?Number(r):t,ba=(r,t="")=>typeof r=="string"&&r.length>0?r:t;function ov(r={}){const t=e=>Math.max(-1,Math.min(1,yr(e,0)));return{worldId:ba(r.worldId),participantId:ba(r.participantId),controllerId:ba(r.controllerId),entityId:ba(r.entityId),moveX:t(r.moveX),moveY:t(r.moveY),run:!!r.run,jump:!!r.jump,yaw:yr(r.yaw,0),pitch:yr(r.pitch,0),sequence:Math.trunc(yr(r.sequence,0)),timestampSeconds:yr(r.timestampSeconds,performance.now()/1e3)}}const lv=Object.freeze({KeyW:"forward",ArrowUp:"forward",KeyS:"backward",ArrowDown:"backward",KeyA:"left",ArrowLeft:"left",KeyD:"right",ArrowRight:"right",ShiftLeft:"run",ShiftRight:"run",Space:"jump"}),hv=new Set(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]),so=Object.freeze({POINTER_LOCK:"pointer-lock",DRAG:"drag",ALWAYS:"always"});class cv{constructor(t={}){this.target=t.target??window,this.controllerId=String(t.controllerId??""),this.keyBindings={...lv,...t.keyBindings??{}},this.actionBindings={...t.actionBindings??{}},this.pointerSensitivity=Number(t.pointerSensitivity??.0025),this.invertPitch=!!t.invertPitch,this.maxPitch=Number(t.maxPitch??Math.PI/2-.05),this.lookMode=String(t.lookMode??so.POINTER_LOCK),this.gamepadIndex=t.gamepadIndex??null,this.axes={forward:0,backward:0,left:0,right:0},this.run=!1,this.jump=!1,this.yaw=0,this.pitch=0,this.sequence=0,this.enabled=!1,this.pointerDown=!1,this.pressedActions=new Set,this.actionListeners=new Set,this.teardown=[]}enable(){if(this.enabled)return this;this.enabled=!0;const t=(e,i,n,s)=>{e.addEventListener(i,n,s),this.teardown.push(()=>e.removeEventListener(i,n,s))};return t(window,"keydown",e=>this.#t(e,!0)),t(window,"keyup",e=>this.#t(e,!1)),t(window,"blur",()=>this.reset()),this.target!==window&&(t(this.target,"pointermove",e=>this.#s(e)),t(this.target,"pointerdown",e=>this.#i(e,!0)),t(this.target,"pointerup",e=>this.#i(e,!1)),t(this.target,"contextmenu",e=>e.preventDefault()),t(window,"pointerup",e=>this.#i(e,!1)),t(window,"pointercancel",()=>{this.pointerDown=!1})),this}disable(){for(const t of this.teardown)t();return this.teardown=[],this.enabled=!1,this.reset(),this}reset(){return this.axes={forward:0,backward:0,left:0,right:0},this.run=!1,this.jump=!1,this.pointerDown=!1,this.pressedActions.clear(),this}setLook(t,e=this.pitch){return this.yaw=Number(t)||0,this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,Number(e)||0)),this}onAction(t){if(typeof t!="function")throw new TypeError("onAction requires a function");return this.actionListeners.add(t),()=>this.actionListeners.delete(t)}isActionHeld(t){return this.pressedActions.has(String(t))}sample(t={}){this.#a();const e=this.axes.forward-this.axes.backward,i=this.axes.right-this.axes.left,n=this.jump;return this.jump=!1,this.sequence+=1,ov({worldId:t.worldId,participantId:t.participantId,controllerId:t.controllerId??this.controllerId,entityId:t.entityId,moveX:i,moveY:e,run:this.run,jump:n,yaw:this.yaw,pitch:this.pitch,sequence:this.sequence})}pipeToSession(t,e,i){return e.onTick(()=>{t.enqueueInputState(this.sample(i))})}#t(t,e){const i=this.keyBindings[t.code];i&&(i==="run"?this.run=e:i==="jump"?(e&&!this.pressedActions.has("jump")&&(this.jump=!0),this.#n("jump",e)):i in this.axes&&(this.axes[i]=e?1:0),hv.has(t.code)&&t.preventDefault());const n=this.actionBindings[t.code];n&&this.#n(n,e)}#i(t,e){this.pointerDown=e?!0:(t.buttons??0)!==0;const i=this.actionBindings[`Mouse${t.button}`]??(t.button===0?"primary":t.button===2?"secondary":"");i&&this.#n(i,e)}#s(t){if(this.lookMode===so.POINTER_LOCK){if(!document.pointerLockElement)return}else if(this.lookMode===so.DRAG&&!this.pointerDown)return;const e=Number(t.movementX??0),i=Number(t.movementY??0);if(e===0&&i===0)return;this.yaw-=e*this.pointerSensitivity;const n=this.invertPitch?1:-1;this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,this.pitch+n*i*this.pointerSensitivity))}#n(t,e){const i=String(t),n=this.pressedActions.has(i);if(e&&!n){this.pressedActions.add(i);for(const s of this.actionListeners)s(i,"pressed")}else if(!e&&n){this.pressedActions.delete(i);for(const s of this.actionListeners)s(i,"released")}}#a(){if(this.gamepadIndex===null)return;const e=(navigator.getGamepads?.()??[])[this.gamepadIndex];if(!e)return;const i=.15,n=o=>Math.abs(o)<i?0:o,s=n(e.axes[0]??0),a=n(e.axes[1]??0);this.axes.right=Math.max(0,s),this.axes.left=Math.max(0,-s),this.axes.forward=Math.max(0,-a),this.axes.backward=Math.max(0,a),this.yaw-=n(e.axes[2]??0)*.04,this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,this.pitch-n(e.axes[3]??0)*.04)),this.run=!!e.buttons[10]?.pressed,e.buttons[0]?.pressed&&!this.pressedActions.has("jump")&&(this.jump=!0),this.#n("jump",!!e.buttons[0]?.pressed),this.#n("primary",!!e.buttons[7]?.pressed),this.#n("secondary",!!e.buttons[6]?.pressed)}}const Fu=.9,Dr=1e-4;function cl(r=2654435769){let t=r>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}const Uu=r=>Math.max(Dr,r);class uv{constructor({context:t=null,drone:e=!0}={}){this.ctx=null,this.muted=!1,this.useDrone=e,this.rand=cl(),this.charge=null,this.listener={x:0,y:0,z:0,yaw:0},this.#h(),t&&this.#t(t)}unlock(){if(this.ctx){this.ctx.state==="suspended"&&this.ctx.resume&&this.ctx.resume();return}const t=globalThis.AudioContext??globalThis.webkitAudioContext;t&&this.#t(new t)}setMuted(t){this.muted=!!t,this.master&&this.master.gain.setTargetAtTime(this.muted?0:Fu,this.ctx.currentTime,.05)}setListener(t,e,i,n=0){if(this.listener={x:t,y:e,z:i,yaw:n},!this.ctx)return;const s=this.ctx.listener,a=-Math.sin(n),o=-Math.cos(n);if(s.positionX){const l=this.ctx.currentTime;s.positionX.setValueAtTime(t,l),s.positionY.setValueAtTime(e,l),s.positionZ.setValueAtTime(i,l),s.forwardX.setValueAtTime(a,l),s.forwardY.setValueAtTime(0,l),s.forwardZ.setValueAtTime(o,l),s.upX.setValueAtTime(0,l),s.upY.setValueAtTime(1,l),s.upZ.setValueAtTime(0,l)}else s.setPosition?.(t,e,i),s.setOrientation?.(a,0,o,0,1,0)}#t(t){this.ctx=t,this.limiter=t.createDynamicsCompressor(),this.limiter.threshold.value=-6,this.limiter.knee.value=0,this.limiter.ratio.value=20,this.limiter.attack.value=.001,this.limiter.release.value=.12,this.master=t.createGain(),this.master.gain.value=this.muted?0:Fu,this.limiter.connect(this.master).connect(t.destination),this.bus=t.createGain(),this.bus.connect(this.limiter),this.dry=t.createGain(),this.dry.connect(this.bus),this.reverb=t.createConvolver(),this.reverb.buffer=this.#i(3.2,2.6),this.wet=t.createGain(),this.wet.gain.value=.5,this.reverb.connect(this.wet).connect(this.bus),this.brown=this.#s(3,!0),this.white=this.#s(2,!1),this.setListener(this.listener.x,this.listener.y,this.listener.z,this.listener.yaw),this.useDrone&&this.#u()}#i(t,e){const{ctx:i}=this,n=Math.floor(i.sampleRate*t),s=i.createBuffer(2,n,i.sampleRate),a=cl(1234);for(let o=0;o<2;o+=1){const l=s.getChannelData(o),h=Math.floor(i.sampleRate*.012);let c=0;for(let d=h;d<n;d+=1){const u=d/n,f=.25+.7*u;c+=(1-f)*(a()*2-1-c),l[d]=c*(1-u)**e}}return s}#s(t,e){const{ctx:i}=this,n=Math.floor(i.sampleRate*t),s=i.createBuffer(1,n,i.sampleRate),a=s.getChannelData(0),o=cl(e?77:99);let l=0,h=0;for(let c=0;c<n;c+=1){const d=o()*2-1;e?(l=(l+.02*d)/1.02,a[c]=l):a[c]=d,h=Math.max(h,Math.abs(a[c]))}for(let c=0;c<n;c+=1)a[c]/=h||1;return s}#n(){return this.ctx.currentTime+.005}#a(t,{pos:e=null,pan:i=0,wet:n=.5,dry:s=1}={}){const{ctx:a}=this;let o=t;if(e){const l=a.createPanner();l.panningModel="HRTF",l.distanceModel="inverse",l.refDistance=1.5,l.rolloffFactor=1.1,l.maxDistance=60,l.positionX?(l.positionX.value=e.x??0,l.positionY.value=e.y??0,l.positionZ.value=e.z??0):l.setPosition(e.x??0,e.y??0,e.z??0),t.connect(l),o=l}else if(i){const l=a.createStereoPanner();l.pan.value=Math.max(-1,Math.min(1,i)),t.connect(l),o=l}if(s>0){const l=a.createGain();l.gain.value=s,o.connect(l).connect(this.dry)}if(n>0){const l=a.createGain();l.gain.value=n,o.connect(l).connect(this.reverb)}}#o(t,{gain:e,attack:i=.005,dur:n,hold:s=0}){const a=this.ctx.createGain();return a.gain.setValueAtTime(Dr,t),a.gain.exponentialRampToValueAtTime(Uu(e),t+i),s>0&&a.gain.setValueAtTime(Uu(e),t+i+s),a.gain.exponentialRampToValueAtTime(Dr,t+Math.max(n,i+s+.01)),a}#e({type:t="sine",f0:e,f1:i=e,t:n=0,dur:s,gain:a,attack:o=.005,hold:l=0,dest:h=null,...c}){const{ctx:d}=this,u=this.#n()+n,f=d.createOscillator();f.type=t,f.frequency.setValueAtTime(e,u),i!==e&&f.frequency.exponentialRampToValueAtTime(Math.max(20,i),u+s);const p=this.#o(u,{gain:a,attack:o,dur:s,hold:l});f.connect(p),h?p.connect(h):this.#a(p,c),f.start(u),f.stop(u+s+.05)}#r({brown:t=!1,t:e=0,dur:i,gain:n,attack:s=.005,hold:a=0,filter:o="bandpass",freq:l=1e3,freq1:h=l,q:c=1,dest:d=null,...u}){const{ctx:f}=this,p=this.#n()+e,x=t?this.brown:this.white,g=f.createBufferSource();g.buffer=x,g.loop=!0;const m=f.createBiquadFilter();m.type=o,m.Q.value=c,m.frequency.setValueAtTime(l,p),h!==l&&m.frequency.exponentialRampToValueAtTime(Math.max(20,h),p+i);const M=this.#o(p,{gain:n,attack:s,dur:i,hold:a});g.connect(m).connect(M),d?M.connect(d):this.#a(M,u),g.start(p,this.rand()*(x.duration-.1)),g.stop(p+i+.05)}#u(){const{ctx:t}=this,e=t.createGain();e.gain.value=.025;for(const o of[55,55.6,82.4]){const l=t.createOscillator();l.frequency.value=o,l.connect(e),l.start()}const i=t.createBufferSource();i.buffer=this.brown,i.loop=!0;const n=t.createBiquadFilter();n.type="lowpass",n.frequency.value=220;const s=t.createGain();s.gain.value=.035,i.connect(n).connect(s).connect(this.bus),i.start(),e.connect(this.bus);const a=t.createGain();a.gain.value=.3,e.connect(a).connect(this.reverb)}#l(t,{t:e=0,spread:i=.35,gain:n=.05,low:s=280,high:a=900,...o}={}){for(let l=0;l<t;l+=1){const h=s+this.rand()*(a-s);this.#e({f0:h,f1:h*1.9,t:e+this.rand()*i,dur:.05+this.rand()*.05,gain:n*(.5+this.rand()*.5),attack:.004,...o})}}pulse(t,e=1,{wet:i=!1}={}){if(!this.ctx)return;this.stopCharge();const{ctx:n}=this,s=n.createGain();if(i){const a=n.createBiquadFilter();a.type="lowpass",a.frequency.value=900,a.Q.value=6;const o=n.createOscillator();o.frequency.value=7;const l=n.createGain();l.gain.value=300,o.connect(l).connect(a.frequency);const h=this.#n();o.start(h),o.stop(h+2),s.connect(a);const c=n.createGain();c.gain.value=1.6,a.connect(c),this.#a(c,{wet:.7})}else this.#a(s,{wet:t==="tap"?.35:.8});if(t==="tap")this.#e({f0:2100,f1:1500,dur:.09,gain:.42,dest:s}),this.#e({f0:1500,f1:1200,t:.16,dur:.07,gain:.1,dest:s});else{const a=Math.max(0,Math.min(1,e)),o=t==="full"?.4+a*.25:.28+a*.15;this.#e({f0:1300,f1:520,dur:.5,gain:o,dest:s}),this.#e({type:"triangle",f0:260,f1:110,dur:.6,gain:o*.8,dest:s}),t==="full"&&this.#e({f0:90,f1:45,dur:.5,gain:o*.6,dest:s});for(let l=1;l<=3;l+=1)this.#e({f0:1100-l*120,f1:500,t:.22*l+a*.2,dur:.35,gain:o*.35/l,pan:l%2?-.5:.5,wet:1})}i&&(this.#l(t==="tap"?4:10,{gain:t==="tap"?.06:.1,spread:t==="tap"?.2:.5,wet:.4}),this.#r({dur:.35,gain:t==="tap"?.05:.12,filter:"lowpass",freq:1200,freq1:300,wet:.4}))}startCharge(){if(!this.ctx||this.charge)return;const{ctx:t}=this,e=t.currentTime,i=t.createOscillator();i.type="sine",i.frequency.setValueAtTime(300,e),i.frequency.linearRampToValueAtTime(900,e+1.1);const n=t.createOscillator();n.type="triangle",n.frequency.setValueAtTime(150,e),n.frequency.linearRampToValueAtTime(450,e+1.1);const s=t.createGain();s.gain.value=.4,n.connect(s);const a=t.createGain();a.gain.value=.8;const o=t.createOscillator();o.frequency.setValueAtTime(4,e),o.frequency.linearRampToValueAtTime(14,e+1.1);const l=t.createGain();l.gain.value=.2,o.connect(l).connect(a.gain);const h=t.createGain();h.gain.setValueAtTime(Dr,e),h.gain.exponentialRampToValueAtTime(.14,e+.25),i.connect(a),s.connect(a),a.connect(h),this.#a(h,{wet:.3});for(const c of[i,n,o])c.start(e);this.charge={nodes:[i,n,o],g:h}}stopCharge(){if(!this.charge||!this.ctx)return;const{nodes:t,g:e}=this.charge,i=this.ctx.currentTime;e.gain.cancelScheduledValues(i),e.gain.setTargetAtTime(Dr,i,.02);for(const n of t)n.stop(i+.15);this.charge=null}crystalEcho(t){if(!this.ctx)return;const e=1568;[[1,.32],[2.76,.17],[5.4,.09],[8.93,.045]].forEach(([i,n],s)=>{this.#e({f0:e*i,f1:e*i*.997,t:s*.012,dur:1.6-s*.25,gain:n,attack:.003,pos:t,wet:.8})}),this.#e({f0:e*1.5,t:.14,dur:1,gain:.11,attack:.02,pos:t,wet:.9})}growl(t,{short:e=!1,big:i=!1}={}){if(!this.ctx)return;const{ctx:n}=this,s=this.#n(),a=i?e?.9:2.6:e?.5:1.4,o=i?1.5:e?1:.9,l=i?e?60:36:e?95:58,h=i?e?48:54:e?70:82,c=n.createOscillator();c.type="sawtooth",c.frequency.setValueAtTime(l,s),c.frequency.linearRampToValueAtTime(h,s+a*.6),c.frequency.linearRampToValueAtTime(i?30:48,s+a);const d=n.createOscillator();d.type="sine",d.frequency.setValueAtTime(l/2,s),d.frequency.linearRampToValueAtTime(h/2,s+a*.6);const u=n.createGain();u.gain.value=i?.8:.3,d.connect(u);const f=n.createOscillator();f.frequency.value=i?17:23;const p=n.createGain();p.gain.value=i?12:18,f.connect(p).connect(c.frequency);const x=n.createGain();x.gain.value=.75;const g=n.createOscillator();g.frequency.value=i?9:13;const m=n.createGain();m.gain.value=.25,g.connect(m).connect(x.gain);const M=n.createBufferSource();M.buffer=this.brown,M.loop=!0;const E=n.createGain();E.gain.value=.7;const v=n.createBiquadFilter();v.type="lowpass",v.frequency.setValueAtTime(i?380:520,s),v.frequency.linearRampToValueAtTime(i?650:800,s+a*.5),v.frequency.linearRampToValueAtTime(i?250:400,s+a),v.Q.value=2;const w=this.#o(s,{gain:o,attack:i?.25:.1,dur:a,hold:a*.25});c.connect(v),M.connect(E).connect(v),v.connect(x),u.connect(x),x.connect(w),this.#a(w,{pos:t,wet:i?.7:.5});for(const b of[c,d,f,g])b.start(s),b.stop(s+a+.1);M.start(s,this.rand()*2),M.stop(s+a+.1)}huff(t){this.ctx&&(this.#r({brown:!0,dur:.45,gain:.7,attack:.06,filter:"bandpass",freq:500,freq1:260,q:1.4,pos:t,wet:.4}),this.#r({brown:!0,t:.55,dur:.6,gain:.5,attack:.1,filter:"bandpass",freq:380,freq1:200,q:1.4,pos:t,wet:.4}),this.#e({type:"sawtooth",f0:70,f1:55,t:.55,dur:.5,gain:.05,attack:.08,pos:t,wet:.3}))}chime(t=0){if(!this.ctx)return;const e=1046.5*2**(t%8*2/12);[1,1.26,1.5,2].forEach((i,n)=>this.#e({f0:e*i,dur:1.2,gain:.1,t:n*.07,wet:.8}))}twinkle(t){this.ctx&&(this.#e({f0:2637,dur:.4,gain:.06,pos:t,wet:.9}),this.#e({f0:3322,t:.09,dur:.35,gain:.045,pos:t,wet:.9}))}drip(t){if(!this.ctx)return;const e=1300+this.rand()*900,i=.2+this.rand()*.1;this.#e({f0:e*.6,f1:e*1.3,dur:.03,gain:i*.6,attack:.002,pos:t,wet:1}),this.#e({f0:e,f1:e*.45,t:.025,dur:.12,gain:i,attack:.002,pos:t,wet:1})}wade(t=.5){if(!this.ctx)return;const e=.5+Math.max(0,Math.min(1,t))*.5;this.#r({dur:.28,gain:.08*e,attack:.01,filter:"bandpass",freq:1400,freq1:400,q:.8,pan:(this.rand()-.5)*.3,wet:.35}),this.#r({brown:!0,dur:.2,gain:.12*e,attack:.008,filter:"lowpass",freq:500,wet:.2}),this.#l(3,{gain:.025*e,spread:.18,low:400,high:1100,wet:.3})}footstep(t=.5){if(!this.ctx)return;const e=.5+Math.max(0,Math.min(1,t))*.5;this.#r({brown:!0,dur:.09,gain:.22*e,attack:.004,filter:"lowpass",freq:380,freq1:160,pan:(this.rand()-.5)*.2,wet:.2}),this.#r({dur:.05,gain:.025*e,attack:.002,filter:"highpass",freq:2500,wet:.15})}checkpoint(){this.ctx&&[523.3,659.3,784].forEach(t=>this.#e({type:"triangle",f0:t,dur:1.6,gain:.1,attack:.08,wet:.8}))}exitOpened(){this.ctx&&[392,523.3,659.3,784,1046.5].forEach((t,e)=>this.#e({type:"triangle",f0:t,t:e*.18,dur:2.2,gain:.1,attack:.1,wet:.9}))}caught(){this.ctx&&(this.growl(null,{short:!0}),this.#e({type:"sine",f0:120,f1:30,dur:.9,gain:.5,wet:.4}),this.#r({brown:!0,dur:.6,gain:.3,attack:.01,filter:"lowpass",freq:900,freq1:150,wet:.5}))}win(){this.ctx&&[523.3,659.3,784,1046.5,1318.5,1568].forEach((t,e)=>this.#e({f0:t,t:e*.12,dur:1.8,gain:.1,wet:.9}))}surfaced(){this.ctx&&(this.#r({dur:4,gain:.05,attack:1.2,hold:1.2,filter:"bandpass",freq:900,freq1:2400,q:.6,wet:.4}),[[392,-.4],[587.3,.4],[784,-.2],[987.8,.2]].forEach(([t,e])=>{this.#e({type:"triangle",f0:t,dur:3.6,gain:.07,attack:.6,hold:1,pan:e,wet:.5})}),[1174.7,1568,1975.5,2349.3,3136].forEach((t,e)=>this.#e({f0:t,t:.4+e*.16,dur:1.4,gain:.07,pan:e%2?.5:-.5,wet:.6})))}heartbeat(t=.5){this.ctx&&this.#c(this.#n(),t)}#c(t,e){const i=.6+Math.max(0,Math.min(1,e))*.4,n=t-this.#n();this.#e({f0:70,f1:42,t:n,dur:.16,gain:.32*i,attack:.008,wet:.1}),this.#e({f0:140,f1:80,t:n,dur:.06,gain:.08*i,attack:.004,wet:.05}),this.#e({f0:62,f1:40,t:n+.28,dur:.14,gain:.24*i,attack:.008,wet:.1}),this.#e({f0:124,f1:72,t:n+.28,dur:.05,gain:.06*i,attack:.004,wet:.05})}#h(){this.nextDrip=2,this.nextTwinkle=1.5,this.nextBeatAt=0}stopAll(){this.stopCharge(),this.#h()}update(t,{playing:e,nearestMoth:i=null,dripSpot:n=null,danger:s=1/0}={}){if(!this.ctx||!e)return;if(this.nextDrip-=t,this.nextDrip<=0){this.nextDrip=1.2+this.rand()*3.8;const o=typeof n=="function"?n():null;o&&this.drip(o)}this.nextTwinkle-=t,this.nextTwinkle<=0&&(this.nextTwinkle=2.2+this.rand()*.6,i&&i.pos&&i.distance<20&&this.twinkle(i.pos));const a=this.ctx.currentTime;if(Number.isFinite(s)&&s<16){const o=Math.max(0,Math.min(1,(16-s)/14.5)),l=55+o*95;for(this.nextBeatAt<a&&(this.nextBeatAt=a+.05);this.nextBeatAt<a+.15;)this.#c(this.nextBeatAt,o),this.nextBeatAt+=60/l}else this.nextBeatAt=0}}/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const bf="185",fo=0,dv=1,Eo=2,po=1,Qn=2,zu=100,Ou=204,ku=205,Bu=3,fv=0,Sf=300,Vu=1e3,Sa=1001,Gu=1002,Lh=1006,pv=1008,mv=1009,gv=1015,Hu=1016,xv=1023,wf="",ui="srgb",Wu="srgb-linear",Xu="linear",ul="srgb",Ss=7680,qu=519,Nh=35044,_v=35048,Ir=2e3,$u=2001;function yv(r){for(let t=r.length-1;t>=0;--t)if(r[t]>=65535)return!0;return!1}function Yu(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}const Zu={};function Ku(...r){const t="THREE."+r.shift();console.log(t,...r)}function Ef(r){const t=r[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=r[1];e&&e.isStackTrace?r[0]+=" "+e.getLocation():r[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return r}function Fe(...r){r=Ef(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...r)}}function An(...r){r=Ef(r);const t="THREE."+r.shift();{const e=r[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...r)}}function Ur(...r){const t=r.join(" ");t in Zu||(Zu[t]=!0,Fe(...r))}class lr{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(e)===-1&&i[t].push(e)}hasEventListener(t,e){const i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(e)!==-1}removeEventListener(t,e){const i=this._listeners;if(i===void 0)return;const n=i[t];if(n!==void 0){const s=n.indexOf(e);s!==-1&&n.splice(s,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const i=e[t.type];if(i!==void 0){t.target=this;const n=i.slice(0);for(let s=0,a=n.length;s<a;s++)n[s].call(this,t);t.target=null}}}const Ve=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];function Pn(){const r=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(Ve[r&255]+Ve[r>>8&255]+Ve[r>>16&255]+Ve[r>>24&255]+"-"+Ve[t&255]+Ve[t>>8&255]+"-"+Ve[t>>16&15|64]+Ve[t>>24&255]+"-"+Ve[e&63|128]+Ve[e>>8&255]+"-"+Ve[e>>16&255]+Ve[e>>24&255]+Ve[i&255]+Ve[i>>8&255]+Ve[i>>16&255]+Ve[i>>24&255]).toLowerCase()}function Yt(r,t,e){return Math.max(t,Math.min(e,r))}function vv(r,t){return(r%t+t)%t}function dl(r,t,e){return(1-e)*r+e*t}function ki(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function ie(r,t){switch(t.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}class se{static{se.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,i=this.y,n=t.elements;return this.x=n[0]*e+n[3]*i+n[6],this.y=n[1]*e+n[4]*i+n[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Yt(this.x,t.x,e.x),this.y=Yt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Yt(this.x,t,e),this.y=Yt(this.y,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Yt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Yt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y;return e*e+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const i=Math.cos(e),n=Math.sin(e),s=this.x-t.x,a=this.y-t.y;return this.x=s*i-a*n+t.x,this.y=s*n+a*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class hr{constructor(t=0,e=0,i=0,n=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=i,this._w=n}static slerpFlat(t,e,i,n,s,a,o){let l=i[n+0],h=i[n+1],c=i[n+2],d=i[n+3],u=s[a+0],f=s[a+1],p=s[a+2],x=s[a+3];if(d!==x||l!==u||h!==f||c!==p){let g=l*u+h*f+c*p+d*x;g<0&&(u=-u,f=-f,p=-p,x=-x,g=-g);let m=1-o;if(g<.9995){const M=Math.acos(g),E=Math.sin(M);m=Math.sin(m*M)/E,o=Math.sin(o*M)/E,l=l*m+u*o,h=h*m+f*o,c=c*m+p*o,d=d*m+x*o}else{l=l*m+u*o,h=h*m+f*o,c=c*m+p*o,d=d*m+x*o;const M=1/Math.sqrt(l*l+h*h+c*c+d*d);l*=M,h*=M,c*=M,d*=M}}t[e]=l,t[e+1]=h,t[e+2]=c,t[e+3]=d}static multiplyQuaternionsFlat(t,e,i,n,s,a){const o=i[n],l=i[n+1],h=i[n+2],c=i[n+3],d=s[a],u=s[a+1],f=s[a+2],p=s[a+3];return t[e]=o*p+c*d+l*f-h*u,t[e+1]=l*p+c*u+h*d-o*f,t[e+2]=h*p+c*f+o*u-l*d,t[e+3]=c*p-o*d-l*u-h*f,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,i,n){return this._x=t,this._y=e,this._z=i,this._w=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const i=t._x,n=t._y,s=t._z,a=t._order,o=Math.cos,l=Math.sin,h=o(i/2),c=o(n/2),d=o(s/2),u=l(i/2),f=l(n/2),p=l(s/2);switch(a){case"XYZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"YXZ":this._x=u*c*d+h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"ZXY":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d-u*f*p;break;case"ZYX":this._x=u*c*d-h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d+u*f*p;break;case"YZX":this._x=u*c*d+h*f*p,this._y=h*f*d+u*c*p,this._z=h*c*p-u*f*d,this._w=h*c*d-u*f*p;break;case"XZY":this._x=u*c*d-h*f*p,this._y=h*f*d-u*c*p,this._z=h*c*p+u*f*d,this._w=h*c*d+u*f*p;break;default:Fe("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const i=e/2,n=Math.sin(i);return this._x=t.x*n,this._y=t.y*n,this._z=t.z*n,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,i=e[0],n=e[4],s=e[8],a=e[1],o=e[5],l=e[9],h=e[2],c=e[6],d=e[10],u=i+o+d;if(u>0){const f=.5/Math.sqrt(u+1);this._w=.25/f,this._x=(c-l)*f,this._y=(s-h)*f,this._z=(a-n)*f}else if(i>o&&i>d){const f=2*Math.sqrt(1+i-o-d);this._w=(c-l)/f,this._x=.25*f,this._y=(n+a)/f,this._z=(s+h)/f}else if(o>d){const f=2*Math.sqrt(1+o-i-d);this._w=(s-h)/f,this._x=(n+a)/f,this._y=.25*f,this._z=(l+c)/f}else{const f=2*Math.sqrt(1+d-i-o);this._w=(a-n)/f,this._x=(s+h)/f,this._y=(l+c)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let i=t.dot(e)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Yt(this.dot(t),-1,1)))}rotateTowards(t,e){const i=this.angleTo(t);if(i===0)return this;const n=Math.min(1,e/i);return this.slerp(t,n),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const i=t._x,n=t._y,s=t._z,a=t._w,o=e._x,l=e._y,h=e._z,c=e._w;return this._x=i*c+a*o+n*h-s*l,this._y=n*c+a*l+s*o-i*h,this._z=s*c+a*h+i*l-n*o,this._w=a*c-i*o-n*l-s*h,this._onChangeCallback(),this}slerp(t,e){let i=t._x,n=t._y,s=t._z,a=t._w,o=this.dot(t);o<0&&(i=-i,n=-n,s=-s,a=-a,o=-o);let l=1-e;if(o<.9995){const h=Math.acos(o),c=Math.sin(h);l=Math.sin(l*h)/c,e=Math.sin(e*h)/c,this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+s*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,i){return this.copy(t).slerp(e,i)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),i=Math.random(),n=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(n*Math.sin(t),n*Math.cos(t),s*Math.sin(e),s*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class ${static{$.prototype.isVector3=!0}constructor(t=0,e=0,i=0){this.x=t,this.y=e,this.z=i}set(t,e,i){return i===void 0&&(i=this.z),this.x=t,this.y=e,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(Ju.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(Ju.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[3]*i+s[6]*n,this.y=s[1]*e+s[4]*i+s[7]*n,this.z=s[2]*e+s[5]*i+s[8]*n,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=t.elements,a=1/(s[3]*e+s[7]*i+s[11]*n+s[15]);return this.x=(s[0]*e+s[4]*i+s[8]*n+s[12])*a,this.y=(s[1]*e+s[5]*i+s[9]*n+s[13])*a,this.z=(s[2]*e+s[6]*i+s[10]*n+s[14])*a,this}applyQuaternion(t){const e=this.x,i=this.y,n=this.z,s=t.x,a=t.y,o=t.z,l=t.w,h=2*(a*n-o*i),c=2*(o*e-s*n),d=2*(s*i-a*e);return this.x=e+l*h+a*d-o*c,this.y=i+l*c+o*h-s*d,this.z=n+l*d+s*c-a*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,i=this.y,n=this.z,s=t.elements;return this.x=s[0]*e+s[4]*i+s[8]*n,this.y=s[1]*e+s[5]*i+s[9]*n,this.z=s[2]*e+s[6]*i+s[10]*n,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Yt(this.x,t.x,e.x),this.y=Yt(this.y,t.y,e.y),this.z=Yt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Yt(this.x,t,e),this.y=Yt(this.y,t,e),this.z=Yt(this.z,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Yt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const i=t.x,n=t.y,s=t.z,a=e.x,o=e.y,l=e.z;return this.x=n*l-s*o,this.y=s*a-i*l,this.z=i*o-n*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const i=t.dot(this)/e;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return fl.copy(this).projectOnVector(t),this.sub(fl)}reflect(t){return this.sub(fl.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Yt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y,n=this.z-t.z;return e*e+i*i+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,i){const n=Math.sin(e)*t;return this.x=n*Math.sin(i),this.y=Math.cos(e)*t,this.z=n*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,i){return this.x=t*Math.sin(e),this.y=i,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),n=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=i,this.z=n,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,i=Math.sqrt(1-e*e);return this.x=i*Math.cos(t),this.y=e,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const fl=new $,Ju=new hr;class cn{static{cn.prototype.isMatrix3=!0}constructor(t,e,i,n,s,a,o,l,h){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h)}set(t,e,i,n,s,a,o,l,h){const c=this.elements;return c[0]=t,c[1]=n,c[2]=o,c[3]=e,c[4]=s,c[5]=l,c[6]=i,c[7]=a,c[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],this}extractBasis(t,e,i){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[3],l=i[6],h=i[1],c=i[4],d=i[7],u=i[2],f=i[5],p=i[8],x=n[0],g=n[3],m=n[6],M=n[1],E=n[4],v=n[7],w=n[2],b=n[5],A=n[8];return s[0]=a*x+o*M+l*w,s[3]=a*g+o*E+l*b,s[6]=a*m+o*v+l*A,s[1]=h*x+c*M+d*w,s[4]=h*g+c*E+d*b,s[7]=h*m+c*v+d*A,s[2]=u*x+f*M+p*w,s[5]=u*g+f*E+p*b,s[8]=u*m+f*v+p*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8];return e*a*c-e*o*h-i*s*c+i*o*l+n*s*h-n*a*l}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=c*a-o*h,u=o*l-c*s,f=h*s-a*l,p=e*d+i*u+n*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);const x=1/p;return t[0]=d*x,t[1]=(n*h-c*i)*x,t[2]=(o*i-n*a)*x,t[3]=u*x,t[4]=(c*e-n*l)*x,t[5]=(n*s-o*e)*x,t[6]=f*x,t[7]=(i*l-h*e)*x,t[8]=(a*e-i*s)*x,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,i,n,s,a,o){const l=Math.cos(s),h=Math.sin(s);return this.set(i*l,i*h,-i*(l*a+h*o)+a+t,-n*h,n*l,-n*(-h*a+l*o)+o+e,0,0,1),this}scale(t,e){return Ur("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(pl.makeScale(t,e)),this}rotate(t){return Ur("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(pl.makeRotation(-t)),this}translate(t,e){return Ur("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(pl.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,i,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<9;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<9;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const pl=new cn,Qu=new cn().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),ju=new cn().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Mv(){const r={enabled:!0,workingColorSpace:Wu,spaces:{},convert:function(n,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===ul&&(n.r=an(n.r),n.g=an(n.g),n.b=an(n.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(n.applyMatrix3(this.spaces[s].toXYZ),n.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===ul&&(n.r=Ks(n.r),n.g=Ks(n.g),n.b=Ks(n.b))),n},workingToColorSpace:function(n,s){return this.convert(n,this.workingColorSpace,s)},colorSpaceToWorking:function(n,s){return this.convert(n,s,this.workingColorSpace)},getPrimaries:function(n){return this.spaces[n].primaries},getTransfer:function(n){return n===wf?Xu:this.spaces[n].transfer},getToneMappingMode:function(n){return this.spaces[n].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(n,s=this.workingColorSpace){return n.fromArray(this.spaces[s].luminanceCoefficients)},define:function(n){Object.assign(this.spaces,n)},_getMatrix:function(n,s,a){return n.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(n){return this.spaces[n].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(n=this.workingColorSpace){return this.spaces[n].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(n,s){return Ur("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),r.workingToColorSpace(n,s)},toWorkingColorSpace:function(n,s){return Ur("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),r.colorSpaceToWorking(n,s)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],i=[.3127,.329];return r.define({[Wu]:{primaries:t,whitePoint:i,transfer:Xu,toXYZ:Qu,fromXYZ:ju,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:ui},outputColorSpaceConfig:{drawingBufferColorSpace:ui}},[ui]:{primaries:t,whitePoint:i,transfer:ul,toXYZ:Qu,fromXYZ:ju,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:ui}}}),r}const vi=Mv();function an(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function Ks(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}let ws;class bv{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{ws===void 0&&(ws=Yu("canvas")),ws.width=t.width,ws.height=t.height;const n=ws.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),i=ws}return i.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Yu("canvas");e.width=t.width,e.height=t.height;const i=e.getContext("2d");i.drawImage(t,0,0,t.width,t.height);const n=i.getImageData(0,0,t.width,t.height),s=n.data;for(let a=0;a<s.length;a++)s[a]=an(s[a]/255)*255;return i.putImageData(n,0,0),e}else if(t.data){const e=t.data.slice(0);for(let i=0;i<e.length;i++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[i]=Math.floor(an(e[i]/255)*255):e[i]=an(e[i]);return{data:e,width:t.width,height:t.height}}else return Fe("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let Sv=0;class Tf{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Sv++}),this.uuid=Pn(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const i={uuid:this.uuid,url:""},n=this.data;if(n!==null){let s;if(Array.isArray(n)){s=[];for(let a=0,o=n.length;a<o;a++)n[a].isDataTexture?s.push(ml(n[a].image)):s.push(ml(n[a]))}else s=ml(n);i.url=s}return e||(t.images[this.uuid]=i),i}}function ml(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?bv.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(Fe("Texture: Unable to serialize Texture."),{})}let wv=0;const gl=new $;class on extends lr{constructor(t=on.DEFAULT_IMAGE,e=on.DEFAULT_MAPPING,i=Sa,n=Sa,s=Lh,a=pv,o=xv,l=mv,h=on.DEFAULT_ANISOTROPY,c=wf){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:wv++}),this.uuid=Pn(),this.name="",this.source=new Tf(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=i,this.wrapT=n,this.magFilter=s,this.minFilter=a,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new se(0,0),this.repeat=new se(1,1),this.center=new se(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new cn,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=c,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(gl).x}get height(){return this.source.getSize(gl).y}get depth(){return this.source.getSize(gl).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const i=t[e];if(i===void 0){Fe(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Fe(`Texture.setValues(): property '${e}' does not exist.`);continue}n&&i&&n.isVector2&&i.isVector2||n&&i&&n.isVector3&&i.isVector3||n&&i&&n.isMatrix3&&i.isMatrix3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),e||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==Sf)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Vu:t.x=t.x-Math.floor(t.x);break;case Sa:t.x=t.x<0?0:1;break;case Gu:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Vu:t.y=t.y-Math.floor(t.y);break;case Sa:t.y=t.y<0?0:1;break;case Gu:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}on.DEFAULT_IMAGE=null;on.DEFAULT_MAPPING=Sf;on.DEFAULT_ANISOTROPY=1;class Wi{static{Wi.prototype.isVector4=!0}constructor(t=0,e=0,i=0,n=1){this.x=t,this.y=e,this.z=i,this.w=n}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,i,n){return this.x=t,this.y=e,this.z=i,this.w=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,s=this.w,a=t.elements;return this.x=a[0]*e+a[4]*i+a[8]*n+a[12]*s,this.y=a[1]*e+a[5]*i+a[9]*n+a[13]*s,this.z=a[2]*e+a[6]*i+a[10]*n+a[14]*s,this.w=a[3]*e+a[7]*i+a[11]*n+a[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,i,n,s;const l=t.elements,h=l[0],c=l[4],d=l[8],u=l[1],f=l[5],p=l[9],x=l[2],g=l[6],m=l[10];if(Math.abs(c-u)<.01&&Math.abs(d-x)<.01&&Math.abs(p-g)<.01){if(Math.abs(c+u)<.1&&Math.abs(d+x)<.1&&Math.abs(p+g)<.1&&Math.abs(h+f+m-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const E=(h+1)/2,v=(f+1)/2,w=(m+1)/2,b=(c+u)/4,A=(d+x)/4,_=(p+g)/4;return E>v&&E>w?E<.01?(i=0,n=.707106781,s=.707106781):(i=Math.sqrt(E),n=b/i,s=A/i):v>w?v<.01?(i=.707106781,n=0,s=.707106781):(n=Math.sqrt(v),i=b/n,s=_/n):w<.01?(i=.707106781,n=.707106781,s=0):(s=Math.sqrt(w),i=A/s,n=_/s),this.set(i,n,s,e),this}let M=Math.sqrt((g-p)*(g-p)+(d-x)*(d-x)+(u-c)*(u-c));return Math.abs(M)<.001&&(M=1),this.x=(g-p)/M,this.y=(d-x)/M,this.z=(u-c)/M,this.w=Math.acos((h+f+m-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Yt(this.x,t.x,e.x),this.y=Yt(this.y,t.y,e.y),this.z=Yt(this.z,t.z,e.z),this.w=Yt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Yt(this.x,t,e),this.y=Yt(this.y,t,e),this.z=Yt(this.z,t,e),this.w=Yt(this.w,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Yt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this.w=t.w+(e.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Ev extends lr{constructor(t=1,e=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Lh,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},i),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=i.depth,this.scissor=new Wi(0,0,t,e),this.scissorTest=!1,this.viewport=new Wi(0,0,t,e),this.textures=[];const n={width:t,height:e,depth:i.depth},s=new on(n),a=i.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview,this.useArrayDepthTexture=i.useArrayDepthTexture}_setTextureOptions(t={}){const e={minFilter:Lh,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,i=1){if(this.width!==t||this.height!==e||this.depth!==i){this.width=t,this.height=e,this.depth=i;for(let n=0,s=this.textures.length;n<s;n++)this.textures[n].image.width=t,this.textures[n].image.height=e,this.textures[n].image.depth=i,this.textures[n].isData3DTexture!==!0&&(this.textures[n].isArrayTexture=this.textures[n].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,i=t.textures.length;e<i;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const n=Object.assign({},t.textures[e].image);this.textures[e].source=new Tf(n)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}}class td extends Ev{constructor(t=1,e=1,i={}){super(t,e,i),this.isWebGLRenderTarget=!0}}class ze{static{ze.prototype.isMatrix4=!0}constructor(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,g){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,g)}set(t,e,i,n,s,a,o,l,h,c,d,u,f,p,x,g){const m=this.elements;return m[0]=t,m[4]=e,m[8]=i,m[12]=n,m[1]=s,m[5]=a,m[9]=o,m[13]=l,m[2]=h,m[6]=c,m[10]=d,m[14]=u,m[3]=f,m[7]=p,m[11]=x,m[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new ze().fromArray(this.elements)}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],e[9]=i[9],e[10]=i[10],e[11]=i[11],e[12]=i[12],e[13]=i[13],e[14]=i[14],e[15]=i[15],this}copyPosition(t){const e=this.elements,i=t.elements;return e[12]=i[12],e[13]=i[13],e[14]=i[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,i){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,e,i){return this.set(t.x,e.x,i.x,0,t.y,e.y,i.y,0,t.z,e.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,i=t.elements,n=1/Es.setFromMatrixColumn(t,0).length(),s=1/Es.setFromMatrixColumn(t,1).length(),a=1/Es.setFromMatrixColumn(t,2).length();return e[0]=i[0]*n,e[1]=i[1]*n,e[2]=i[2]*n,e[3]=0,e[4]=i[4]*s,e[5]=i[5]*s,e[6]=i[6]*s,e[7]=0,e[8]=i[8]*a,e[9]=i[9]*a,e[10]=i[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,i=t.x,n=t.y,s=t.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(n),h=Math.sin(n),c=Math.cos(s),d=Math.sin(s);if(t.order==="XYZ"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=-l*d,e[8]=h,e[1]=f+p*h,e[5]=u-x*h,e[9]=-o*l,e[2]=x-u*h,e[6]=p+f*h,e[10]=a*l}else if(t.order==="YXZ"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u+x*o,e[4]=p*o-f,e[8]=a*h,e[1]=a*d,e[5]=a*c,e[9]=-o,e[2]=f*o-p,e[6]=x+u*o,e[10]=a*l}else if(t.order==="ZXY"){const u=l*c,f=l*d,p=h*c,x=h*d;e[0]=u-x*o,e[4]=-a*d,e[8]=p+f*o,e[1]=f+p*o,e[5]=a*c,e[9]=x-u*o,e[2]=-a*h,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const u=a*c,f=a*d,p=o*c,x=o*d;e[0]=l*c,e[4]=p*h-f,e[8]=u*h+x,e[1]=l*d,e[5]=x*h+u,e[9]=f*h-p,e[2]=-h,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=x-u*d,e[8]=p*d+f,e[1]=d,e[5]=a*c,e[9]=-o*c,e[2]=-h*c,e[6]=f*d+p,e[10]=u-x*d}else if(t.order==="XZY"){const u=a*l,f=a*h,p=o*l,x=o*h;e[0]=l*c,e[4]=-d,e[8]=h*c,e[1]=u*d+x,e[5]=a*c,e[9]=f*d-p,e[2]=p*d-f,e[6]=o*c,e[10]=x*d+u}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Tv,t,Av)}lookAt(t,e,i){const n=this.elements;return ii.subVectors(t,e),ii.lengthSq()===0&&(ii.z=1),ii.normalize(),vn.crossVectors(i,ii),vn.lengthSq()===0&&(Math.abs(i.z)===1?ii.x+=1e-4:ii.z+=1e-4,ii.normalize(),vn.crossVectors(i,ii)),vn.normalize(),wa.crossVectors(ii,vn),n[0]=vn.x,n[4]=wa.x,n[8]=ii.x,n[1]=vn.y,n[5]=wa.y,n[9]=ii.y,n[2]=vn.z,n[6]=wa.z,n[10]=ii.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,s=this.elements,a=i[0],o=i[4],l=i[8],h=i[12],c=i[1],d=i[5],u=i[9],f=i[13],p=i[2],x=i[6],g=i[10],m=i[14],M=i[3],E=i[7],v=i[11],w=i[15],b=n[0],A=n[4],_=n[8],T=n[12],C=n[1],P=n[5],D=n[9],O=n[13],H=n[2],F=n[6],q=n[10],G=n[14],J=n[3],et=n[7],at=n[11],rt=n[15];return s[0]=a*b+o*C+l*H+h*J,s[4]=a*A+o*P+l*F+h*et,s[8]=a*_+o*D+l*q+h*at,s[12]=a*T+o*O+l*G+h*rt,s[1]=c*b+d*C+u*H+f*J,s[5]=c*A+d*P+u*F+f*et,s[9]=c*_+d*D+u*q+f*at,s[13]=c*T+d*O+u*G+f*rt,s[2]=p*b+x*C+g*H+m*J,s[6]=p*A+x*P+g*F+m*et,s[10]=p*_+x*D+g*q+m*at,s[14]=p*T+x*O+g*G+m*rt,s[3]=M*b+E*C+v*H+w*J,s[7]=M*A+E*P+v*F+w*et,s[11]=M*_+E*D+v*q+w*at,s[15]=M*T+E*O+v*G+w*rt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[12],a=t[1],o=t[5],l=t[9],h=t[13],c=t[2],d=t[6],u=t[10],f=t[14],p=t[3],x=t[7],g=t[11],m=t[15],M=l*f-h*u,E=o*f-h*d,v=o*u-l*d,w=a*f-h*c,b=a*u-l*c,A=a*d-o*c;return e*(x*M-g*E+m*v)-i*(p*M-g*w+m*b)+n*(p*E-x*w+m*A)-s*(p*v-x*b+g*A)}determinantAffine(){const t=this.elements,e=t[0],i=t[4],n=t[8],s=t[1],a=t[5],o=t[9],l=t[2],h=t[6],c=t[10];return e*(a*c-o*h)-i*(s*c-o*l)+n*(s*h-a*l)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,i){const n=this.elements;return t.isVector3?(n[12]=t.x,n[13]=t.y,n[14]=t.z):(n[12]=t,n[13]=e,n[14]=i),this}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],s=t[3],a=t[4],o=t[5],l=t[6],h=t[7],c=t[8],d=t[9],u=t[10],f=t[11],p=t[12],x=t[13],g=t[14],m=t[15],M=e*o-i*a,E=e*l-n*a,v=e*h-s*a,w=i*l-n*o,b=i*h-s*o,A=n*h-s*l,_=c*x-d*p,T=c*g-u*p,C=c*m-f*p,P=d*g-u*x,D=d*m-f*x,O=u*m-f*g,H=M*O-E*D+v*P+w*C-b*T+A*_;if(H===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const F=1/H;return t[0]=(o*O-l*D+h*P)*F,t[1]=(n*D-i*O-s*P)*F,t[2]=(x*A-g*b+m*w)*F,t[3]=(u*b-d*A-f*w)*F,t[4]=(l*C-a*O-h*T)*F,t[5]=(e*O-n*C+s*T)*F,t[6]=(g*v-p*A-m*E)*F,t[7]=(c*A-u*v+f*E)*F,t[8]=(a*D-o*C+h*_)*F,t[9]=(i*C-e*D-s*_)*F,t[10]=(p*b-x*v+m*M)*F,t[11]=(d*v-c*b-f*M)*F,t[12]=(o*T-a*P-l*_)*F,t[13]=(e*P-i*T+n*_)*F,t[14]=(x*E-p*w-g*M)*F,t[15]=(c*w-d*E+u*M)*F,this}scale(t){const e=this.elements,i=t.x,n=t.y,s=t.z;return e[0]*=i,e[4]*=n,e[8]*=s,e[1]*=i,e[5]*=n,e[9]*=s,e[2]*=i,e[6]*=n,e[10]*=s,e[3]*=i,e[7]*=n,e[11]*=s,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],n=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,i,n))}makeTranslation(t,e,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,i,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,e,-i,0,0,i,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,0,i,0,0,1,0,0,-i,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,0,i,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const i=Math.cos(e),n=Math.sin(e),s=1-i,a=t.x,o=t.y,l=t.z,h=s*a,c=s*o;return this.set(h*a+i,h*o-n*l,h*l+n*o,0,h*o+n*l,c*o+i,c*l-n*a,0,h*l-n*o,c*l+n*a,s*l*l+i,0,0,0,0,1),this}makeScale(t,e,i){return this.set(t,0,0,0,0,e,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,e,i,n,s,a){return this.set(1,i,s,0,t,1,a,0,e,n,1,0,0,0,0,1),this}compose(t,e,i){const n=this.elements,s=e._x,a=e._y,o=e._z,l=e._w,h=s+s,c=a+a,d=o+o,u=s*h,f=s*c,p=s*d,x=a*c,g=a*d,m=o*d,M=l*h,E=l*c,v=l*d,w=i.x,b=i.y,A=i.z;return n[0]=(1-(x+m))*w,n[1]=(f+v)*w,n[2]=(p-E)*w,n[3]=0,n[4]=(f-v)*b,n[5]=(1-(u+m))*b,n[6]=(g+M)*b,n[7]=0,n[8]=(p+E)*A,n[9]=(g-M)*A,n[10]=(1-(u+x))*A,n[11]=0,n[12]=t.x,n[13]=t.y,n[14]=t.z,n[15]=1,this}decompose(t,e,i){const n=this.elements;t.x=n[12],t.y=n[13],t.z=n[14];const s=this.determinantAffine();if(s===0)return i.set(1,1,1),e.identity(),this;let a=Es.set(n[0],n[1],n[2]).length();const o=Es.set(n[4],n[5],n[6]).length(),l=Es.set(n[8],n[9],n[10]).length();s<0&&(a=-a),Mi.copy(this);const h=1/a,c=1/o,d=1/l;return Mi.elements[0]*=h,Mi.elements[1]*=h,Mi.elements[2]*=h,Mi.elements[4]*=c,Mi.elements[5]*=c,Mi.elements[6]*=c,Mi.elements[8]*=d,Mi.elements[9]*=d,Mi.elements[10]*=d,e.setFromRotationMatrix(Mi),i.x=a,i.y=o,i.z=l,this}makePerspective(t,e,i,n,s,a,o=Ir,l=!1){const h=this.elements,c=2*s/(e-t),d=2*s/(i-n),u=(e+t)/(e-t),f=(i+n)/(i-n);let p,x;if(l)p=s/(a-s),x=a*s/(a-s);else if(o===Ir)p=-(a+s)/(a-s),x=-2*a*s/(a-s);else if(o===$u)p=-a/(a-s),x=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=u,h[12]=0,h[1]=0,h[5]=d,h[9]=f,h[13]=0,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,e,i,n,s,a,o=Ir,l=!1){const h=this.elements,c=2/(e-t),d=2/(i-n),u=-(e+t)/(e-t),f=-(i+n)/(i-n);let p,x;if(l)p=1/(a-s),x=a/(a-s);else if(o===Ir)p=-2/(a-s),x=-(a+s)/(a-s);else if(o===$u)p=-1/(a-s),x=-s/(a-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=c,h[4]=0,h[8]=0,h[12]=u,h[1]=0,h[5]=d,h[9]=0,h[13]=f,h[2]=0,h[6]=0,h[10]=p,h[14]=x,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<16;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<16;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t[e+9]=i[9],t[e+10]=i[10],t[e+11]=i[11],t[e+12]=i[12],t[e+13]=i[13],t[e+14]=i[14],t[e+15]=i[15],t}}const Es=new $,Mi=new ze,Tv=new $(0,0,0),Av=new $(1,1,1),vn=new $,wa=new $,ii=new $,ed=new ze,id=new hr;class jn{constructor(t=0,e=0,i=0,n=jn.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=i,this._order=n}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,i,n=this._order){return this._x=t,this._y=e,this._z=i,this._order=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,i=!0){const n=t.elements,s=n[0],a=n[4],o=n[8],l=n[1],h=n[5],c=n[9],d=n[2],u=n[6],f=n[10];switch(e){case"XYZ":this._y=Math.asin(Yt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-c,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(u,h),this._z=0);break;case"YXZ":this._x=Math.asin(-Yt(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-d,s),this._z=0);break;case"ZXY":this._x=Math.asin(Yt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-a,h)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Yt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(u,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,h));break;case"YZX":this._z=Math.asin(Yt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-c,h),this._y=Math.atan2(-d,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Yt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(u,h),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-c,f),this._y=0);break;default:Fe("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,i){return ed.makeRotationFromQuaternion(t),this.setFromRotationMatrix(ed,e,i)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return id.setFromEuler(this),this.setFromQuaternion(id,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}jn.DEFAULT_ORDER="XYZ";class Rv{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let Cv=0;const nd=new $,Ts=new hr,Ki=new ze,Ea=new $,vr=new $,Pv=new $,Dv=new hr,sd=new $(1,0,0),rd=new $(0,1,0),ad=new $(0,0,1),od={type:"added"},Iv={type:"removed"},As={type:"childadded",child:null},xl={type:"childremoved",child:null};class Qe extends lr{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Cv++}),this.uuid=Pn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Qe.DEFAULT_UP.clone();const t=new $,e=new jn,i=new hr,n=new $(1,1,1);function s(){i.setFromEuler(e,!1)}function a(){e.setFromQuaternion(i,void 0,!1)}e._onChange(s),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:n},modelViewMatrix:{value:new ze},normalMatrix:{value:new cn}}),this.matrix=new ze,this.matrixWorld=new ze,this.matrixAutoUpdate=Qe.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Qe.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Rv,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return Ts.setFromAxisAngle(t,e),this.quaternion.multiply(Ts),this}rotateOnWorldAxis(t,e){return Ts.setFromAxisAngle(t,e),this.quaternion.premultiply(Ts),this}rotateX(t){return this.rotateOnAxis(sd,t)}rotateY(t){return this.rotateOnAxis(rd,t)}rotateZ(t){return this.rotateOnAxis(ad,t)}translateOnAxis(t,e){return nd.copy(t).applyQuaternion(this.quaternion),this.position.add(nd.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(sd,t)}translateY(t){return this.translateOnAxis(rd,t)}translateZ(t){return this.translateOnAxis(ad,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Ki.copy(this.matrixWorld).invert())}lookAt(t,e,i){t.isVector3?Ea.copy(t):Ea.set(t,e,i);const n=this.parent;this.updateWorldMatrix(!0,!1),vr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Ki.lookAt(vr,Ea,this.up):Ki.lookAt(Ea,vr,this.up),this.quaternion.setFromRotationMatrix(Ki),n&&(Ki.extractRotation(n.matrixWorld),Ts.setFromRotationMatrix(Ki),this.quaternion.premultiply(Ts.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(An("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(od),As.child=t,this.dispatchEvent(As),As.child=null):An("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(Iv),xl.child=t,this.dispatchEvent(xl),xl.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Ki.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Ki.multiply(t.parent.matrixWorld)),t.applyMatrix4(Ki),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(od),As.child=t,this.dispatchEvent(As),As.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let i=0,n=this.children.length;i<n;i++){const a=this.children[i].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,i=[]){this[t]===e&&i.push(this);const n=this.children;for(let s=0,a=n.length;s<a;s++)n[s].getObjectsByProperty(t,e,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(vr,t,Pv),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(vr,Dv,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,i=t.y,n=t.z,s=this.matrix.elements;s[12]+=e-s[0]*e-s[4]*i-s[8]*n,s[13]+=i-s[1]*e-s[5]*i-s[9]*n,s[14]+=n-s[2]*e-s[6]*i-s[10]*n}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].updateMatrixWorld(t)}updateWorldMatrix(t,e,i=!1){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),e===!0){const s=this.children;for(let a=0,o=s.length;a<o;a++)s[a].updateWorldMatrix(!1,!0,i)}}toJSON(t){const e=t===void 0||typeof t=="string",i={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const n={};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.castShadow===!0&&(n.castShadow=!0),this.receiveShadow===!0&&(n.receiveShadow=!0),this.visible===!1&&(n.visible=!1),this.frustumCulled===!1&&(n.frustumCulled=!1),this.renderOrder!==0&&(n.renderOrder=this.renderOrder),this.static!==!1&&(n.static=this.static),Object.keys(this.userData).length>0&&(n.userData=this.userData),n.layers=this.layers.mask,n.matrix=this.matrix.toArray(),n.up=this.up.toArray(),this.pivot!==null&&(n.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(n.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(n.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(n.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(n.type="InstancedMesh",n.count=this.count,n.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(n.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(n.type="BatchedMesh",n.perObjectFrustumCulled=this.perObjectFrustumCulled,n.sortObjects=this.sortObjects,n.drawRanges=this._drawRanges,n.reservedRanges=this._reservedRanges,n.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),n.instanceInfo=this._instanceInfo.map(o=>({...o})),n.availableInstanceIds=this._availableInstanceIds.slice(),n.availableGeometryIds=this._availableGeometryIds.slice(),n.nextIndexStart=this._nextIndexStart,n.nextVertexStart=this._nextVertexStart,n.geometryCount=this._geometryCount,n.maxInstanceCount=this._maxInstanceCount,n.maxVertexCount=this._maxVertexCount,n.maxIndexCount=this._maxIndexCount,n.geometryInitialized=this._geometryInitialized,n.matricesTexture=this._matricesTexture.toJSON(t),n.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(n.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(n.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(n.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?n.background=this.background.toJSON():this.background.isTexture&&(n.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(n.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){n.geometry=s(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let h=0,c=l.length;h<c;h++){const d=l[h];s(t.shapes,d)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(n.bindMode=this.bindMode,n.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),n.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(s(t.materials,this.material[l]));n.material=o}else n.material=s(t.materials,this.material);if(this.children.length>0){n.children=[];for(let o=0;o<this.children.length;o++)n.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){n.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];n.animations.push(s(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),h=a(t.textures),c=a(t.images),d=a(t.shapes),u=a(t.skeletons),f=a(t.animations),p=a(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),c.length>0&&(i.images=c),d.length>0&&(i.shapes=d),u.length>0&&(i.skeletons=u),f.length>0&&(i.animations=f),p.length>0&&(i.nodes=p)}return i.object=n,i;function a(o){const l=[];for(const h in o){const c=o[h];delete c.metadata,l.push(c)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let i=0;i<t.children.length;i++){const n=t.children[i];this.add(n.clone())}return this}}Qe.DEFAULT_UP=new $(0,1,0);Qe.DEFAULT_MATRIX_AUTO_UPDATE=!0;Qe.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;class Ye extends Qe{constructor(){super(),this.isGroup=!0,this.type="Group"}}const Af={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Mn={h:0,s:0,l:0},Ta={h:0,s:0,l:0};function _l(r,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?r+(t-r)*6*e:e<1/2?t:e<2/3?r+(t-r)*6*(2/3-e):r}class oi{constructor(t,e,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,i)}set(t,e,i){if(e===void 0&&i===void 0){const n=t;n&&n.isColor?this.copy(n):typeof n=="number"?this.setHex(n):typeof n=="string"&&this.setStyle(n)}else this.setRGB(t,e,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=ui){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,vi.colorSpaceToWorking(this,e),this}setRGB(t,e,i,n=vi.workingColorSpace){return this.r=t,this.g=e,this.b=i,vi.colorSpaceToWorking(this,n),this}setHSL(t,e,i,n=vi.workingColorSpace){if(t=vv(t,1),e=Yt(e,0,1),i=Yt(i,0,1),e===0)this.r=this.g=this.b=i;else{const s=i<=.5?i*(1+e):i+e-i*e,a=2*i-s;this.r=_l(a,s,t+1/3),this.g=_l(a,s,t),this.b=_l(a,s,t-1/3)}return vi.colorSpaceToWorking(this,n),this}setStyle(t,e=ui){function i(s){s!==void 0&&parseFloat(s)<1&&Fe("Color: Alpha component of "+t+" will be ignored.")}let n;if(n=/^(\w+)\(([^\)]*)\)/.exec(t)){let s;const a=n[1],o=n[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,e);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,e);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,e);break;default:Fe("Color: Unknown color model "+t)}}else if(n=/^\#([A-Fa-f\d]+)$/.exec(t)){const s=n[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(s,16),e);Fe("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=ui){const i=Af[t.toLowerCase()];return i!==void 0?this.setHex(i,e):Fe("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=an(t.r),this.g=an(t.g),this.b=an(t.b),this}copyLinearToSRGB(t){return this.r=Ks(t.r),this.g=Ks(t.g),this.b=Ks(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=ui){return vi.workingToColorSpace(Ge.copy(this),t),Math.round(Yt(Ge.r*255,0,255))*65536+Math.round(Yt(Ge.g*255,0,255))*256+Math.round(Yt(Ge.b*255,0,255))}getHexString(t=ui){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=vi.workingColorSpace){vi.workingToColorSpace(Ge.copy(this),e);const i=Ge.r,n=Ge.g,s=Ge.b,a=Math.max(i,n,s),o=Math.min(i,n,s);let l,h;const c=(o+a)/2;if(o===a)l=0,h=0;else{const d=a-o;switch(h=c<=.5?d/(a+o):d/(2-a-o),a){case i:l=(n-s)/d+(n<s?6:0);break;case n:l=(s-i)/d+2;break;case s:l=(i-n)/d+4;break}l/=6}return t.h=l,t.s=h,t.l=c,t}getRGB(t,e=vi.workingColorSpace){return vi.workingToColorSpace(Ge.copy(this),e),t.r=Ge.r,t.g=Ge.g,t.b=Ge.b,t}getStyle(t=ui){vi.workingToColorSpace(Ge.copy(this),t);const e=Ge.r,i=Ge.g,n=Ge.b;return t!==ui?`color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${n.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(i*255)},${Math.round(n*255)})`}offsetHSL(t,e,i){return this.getHSL(Mn),this.setHSL(Mn.h+t,Mn.s+e,Mn.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,i){return this.r=t.r+(e.r-t.r)*i,this.g=t.g+(e.g-t.g)*i,this.b=t.b+(e.b-t.b)*i,this}lerpHSL(t,e){this.getHSL(Mn),t.getHSL(Ta);const i=dl(Mn.h,Ta.h,e),n=dl(Mn.s,Ta.s,e),s=dl(Mn.l,Ta.l,e);return this.setHSL(i,n,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,i=this.g,n=this.b,s=t.elements;return this.r=s[0]*e+s[3]*i+s[6]*n,this.g=s[1]*e+s[4]*i+s[7]*n,this.b=s[2]*e+s[5]*i+s[8]*n,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Ge=new oi;oi.NAMES=Af;class Lv extends Qe{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new jn,this.environmentIntensity=1,this.environmentRotation=new jn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}const bi=new $,Ji=new $,yl=new $,Qi=new $,Rs=new $,Cs=new $,ld=new $,vl=new $,Ml=new $,bl=new $,Sl=new Wi,wl=new Wi,El=new Wi;class fi{constructor(t=new $,e=new $,i=new $){this.a=t,this.b=e,this.c=i}static getNormal(t,e,i,n){n.subVectors(i,e),bi.subVectors(t,e),n.cross(bi);const s=n.lengthSq();return s>0?n.multiplyScalar(1/Math.sqrt(s)):n.set(0,0,0)}static getBarycoord(t,e,i,n,s){bi.subVectors(n,e),Ji.subVectors(i,e),yl.subVectors(t,e);const a=bi.dot(bi),o=bi.dot(Ji),l=bi.dot(yl),h=Ji.dot(Ji),c=Ji.dot(yl),d=a*h-o*o;if(d===0)return s.set(0,0,0),null;const u=1/d,f=(h*l-o*c)*u,p=(a*c-o*l)*u;return s.set(1-f-p,p,f)}static containsPoint(t,e,i,n){return this.getBarycoord(t,e,i,n,Qi)===null?!1:Qi.x>=0&&Qi.y>=0&&Qi.x+Qi.y<=1}static getInterpolation(t,e,i,n,s,a,o,l){return this.getBarycoord(t,e,i,n,Qi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Qi.x),l.addScaledVector(a,Qi.y),l.addScaledVector(o,Qi.z),l)}static getInterpolatedAttribute(t,e,i,n,s,a){return Sl.setScalar(0),wl.setScalar(0),El.setScalar(0),Sl.fromBufferAttribute(t,e),wl.fromBufferAttribute(t,i),El.fromBufferAttribute(t,n),a.setScalar(0),a.addScaledVector(Sl,s.x),a.addScaledVector(wl,s.y),a.addScaledVector(El,s.z),a}static isFrontFacing(t,e,i,n){return bi.subVectors(i,e),Ji.subVectors(t,e),bi.cross(Ji).dot(n)<0}set(t,e,i){return this.a.copy(t),this.b.copy(e),this.c.copy(i),this}setFromPointsAndIndices(t,e,i,n){return this.a.copy(t[e]),this.b.copy(t[i]),this.c.copy(t[n]),this}setFromAttributeAndIndices(t,e,i,n){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return bi.subVectors(this.c,this.b),Ji.subVectors(this.a,this.b),bi.cross(Ji).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return fi.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return fi.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,i,n,s){return fi.getInterpolation(t,this.a,this.b,this.c,e,i,n,s)}containsPoint(t){return fi.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return fi.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const i=this.a,n=this.b,s=this.c;let a,o;Rs.subVectors(n,i),Cs.subVectors(s,i),vl.subVectors(t,i);const l=Rs.dot(vl),h=Cs.dot(vl);if(l<=0&&h<=0)return e.copy(i);Ml.subVectors(t,n);const c=Rs.dot(Ml),d=Cs.dot(Ml);if(c>=0&&d<=c)return e.copy(n);const u=l*d-c*h;if(u<=0&&l>=0&&c<=0)return a=l/(l-c),e.copy(i).addScaledVector(Rs,a);bl.subVectors(t,s);const f=Rs.dot(bl),p=Cs.dot(bl);if(p>=0&&f<=p)return e.copy(s);const x=f*h-l*p;if(x<=0&&h>=0&&p<=0)return o=h/(h-p),e.copy(i).addScaledVector(Cs,o);const g=c*p-f*d;if(g<=0&&d-c>=0&&f-p>=0)return ld.subVectors(s,n),o=(d-c)/(d-c+(f-p)),e.copy(n).addScaledVector(ld,o);const m=1/(g+x+u);return a=x*m,o=u*m,e.copy(i).addScaledVector(Rs,a).addScaledVector(Cs,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}class Yr{constructor(t=new $(1/0,1/0,1/0),e=new $(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e+=3)this.expandByPoint(Si.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,i=t.count;e<i;e++)this.expandByPoint(Si.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const i=Si.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const i=t.geometry;if(i!==void 0){const s=i.getAttribute("position");if(e===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,Si):Si.fromBufferAttribute(s,a),Si.applyMatrix4(t.matrixWorld),this.expandByPoint(Si);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),Aa.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Aa.copy(i.boundingBox)),Aa.applyMatrix4(t.matrixWorld),this.union(Aa)}const n=t.children;for(let s=0,a=n.length;s<a;s++)this.expandByObject(n[s],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Si),Si.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,i;return t.normal.x>0?(e=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),e<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Mr),Ra.subVectors(this.max,Mr),Ps.subVectors(t.a,Mr),Ds.subVectors(t.b,Mr),Is.subVectors(t.c,Mr),bn.subVectors(Ds,Ps),Sn.subVectors(Is,Ds),Gn.subVectors(Ps,Is);let e=[0,-bn.z,bn.y,0,-Sn.z,Sn.y,0,-Gn.z,Gn.y,bn.z,0,-bn.x,Sn.z,0,-Sn.x,Gn.z,0,-Gn.x,-bn.y,bn.x,0,-Sn.y,Sn.x,0,-Gn.y,Gn.x,0];return!Tl(e,Ps,Ds,Is,Ra)||(e=[1,0,0,0,1,0,0,0,1],!Tl(e,Ps,Ds,Is,Ra))?!1:(Ca.crossVectors(bn,Sn),e=[Ca.x,Ca.y,Ca.z],Tl(e,Ps,Ds,Is,Ra))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Si).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Si).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(ji[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),ji[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),ji[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),ji[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),ji[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),ji[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),ji[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),ji[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(ji),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}}const ji=[new $,new $,new $,new $,new $,new $,new $,new $],Si=new $,Aa=new Yr,Ps=new $,Ds=new $,Is=new $,bn=new $,Sn=new $,Gn=new $,Mr=new $,Ra=new $,Ca=new $,Hn=new $;function Tl(r,t,e,i,n){for(let s=0,a=r.length-3;s<=a;s+=3){Hn.fromArray(r,s);const o=n.x*Math.abs(Hn.x)+n.y*Math.abs(Hn.y)+n.z*Math.abs(Hn.z),l=t.dot(Hn),h=e.dot(Hn),c=i.dot(Hn);if(Math.max(-Math.max(l,h,c),Math.min(l,h,c))>o)return!1}return!0}const be=new $,Pa=new se;let Nv=0;class Ri extends lr{constructor(t,e,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Nv++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=i,this.usage=Nh,this.updateRanges=[],this.gpuType=gv,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,i){t*=this.itemSize,i*=e.itemSize;for(let n=0,s=this.itemSize;n<s;n++)this.array[t+n]=e.array[i+n];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,i=this.count;e<i;e++)Pa.fromBufferAttribute(this,e),Pa.applyMatrix3(t),this.setXY(e,Pa.x,Pa.y);else if(this.itemSize===3)for(let e=0,i=this.count;e<i;e++)be.fromBufferAttribute(this,e),be.applyMatrix3(t),this.setXYZ(e,be.x,be.y,be.z);return this}applyMatrix4(t){for(let e=0,i=this.count;e<i;e++)be.fromBufferAttribute(this,e),be.applyMatrix4(t),this.setXYZ(e,be.x,be.y,be.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)be.fromBufferAttribute(this,e),be.applyNormalMatrix(t),this.setXYZ(e,be.x,be.y,be.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)be.fromBufferAttribute(this,e),be.transformDirection(t),this.setXYZ(e,be.x,be.y,be.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let i=this.array[t*this.itemSize+e];return this.normalized&&(i=ki(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=ie(i,this.array)),this.array[t*this.itemSize+e]=i,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=ki(e,this.array)),e}setX(t,e){return this.normalized&&(e=ie(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=ki(e,this.array)),e}setY(t,e){return this.normalized&&(e=ie(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=ki(e,this.array)),e}setZ(t,e){return this.normalized&&(e=ie(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=ki(e,this.array)),e}setW(t,e){return this.normalized&&(e=ie(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,i){return t*=this.itemSize,this.normalized&&(e=ie(e,this.array),i=ie(i,this.array)),this.array[t+0]=e,this.array[t+1]=i,this}setXYZ(t,e,i,n){return t*=this.itemSize,this.normalized&&(e=ie(e,this.array),i=ie(i,this.array),n=ie(n,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this}setXYZW(t,e,i,n,s){return t*=this.itemSize,this.normalized&&(e=ie(e,this.array),i=ie(i,this.array),n=ie(n,this.array),s=ie(s,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==Nh&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}}class Fv extends Ri{constructor(t,e,i){super(new Uint16Array(t),e,i)}}class Uv extends Ri{constructor(t,e,i){super(new Uint32Array(t),e,i)}}class Te extends Ri{constructor(t,e,i){super(new Float32Array(t),e,i)}}const zv=new Yr,br=new $,Al=new $;class To{constructor(t=new $,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const i=this.center;e!==void 0?i.copy(e):zv.setFromPoints(t).getCenter(i);let n=0;for(let s=0,a=t.length;s<a;s++)n=Math.max(n,i.distanceToSquared(t[s]));return this.radius=Math.sqrt(n),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const i=this.center.distanceToSquared(t);return e.copy(t),i>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;br.subVectors(t,this.center);const e=br.lengthSq();if(e>this.radius*this.radius){const i=Math.sqrt(e),n=(i-this.radius)*.5;this.center.addScaledVector(br,n/i),this.radius+=n}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(Al.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(br.copy(t.center).add(Al)),this.expandByPoint(br.copy(t.center).sub(Al))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}}let Ov=0;const ci=new ze,Rl=new Qe,Ls=new $,ni=new Yr,Sr=new Yr,De=new $;class Ze extends lr{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Ov++}),this.uuid=Pn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(yv(t)?Uv:Fv)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,i=0){this.groups.push({start:t,count:e,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const s=new cn().getNormalMatrix(t);i.applyNormalMatrix(s),i.needsUpdate=!0}const n=this.attributes.tangent;return n!==void 0&&(n.transformDirection(t),n.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return ci.makeRotationFromQuaternion(t),this.applyMatrix4(ci),this}rotateX(t){return ci.makeRotationX(t),this.applyMatrix4(ci),this}rotateY(t){return ci.makeRotationY(t),this.applyMatrix4(ci),this}rotateZ(t){return ci.makeRotationZ(t),this.applyMatrix4(ci),this}translate(t,e,i){return ci.makeTranslation(t,e,i),this.applyMatrix4(ci),this}scale(t,e,i){return ci.makeScale(t,e,i),this.applyMatrix4(ci),this}lookAt(t){return Rl.lookAt(t),Rl.updateMatrix(),this.applyMatrix4(Rl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ls).negate(),this.translate(Ls.x,Ls.y,Ls.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const i=[];for(let n=0,s=t.length;n<s;n++){const a=t[n];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new Te(i,3))}else{const i=Math.min(t.length,e.count);for(let n=0;n<i;n++){const s=t[n];e.setXYZ(n,s.x,s.y,s.z||0)}t.length>e.count&&Fe("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Yr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){An("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new $(-1/0,-1/0,-1/0),new $(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let i=0,n=e.length;i<n;i++){const s=e[i];ni.setFromBufferAttribute(s),this.morphTargetsRelative?(De.addVectors(this.boundingBox.min,ni.min),this.boundingBox.expandByPoint(De),De.addVectors(this.boundingBox.max,ni.max),this.boundingBox.expandByPoint(De)):(this.boundingBox.expandByPoint(ni.min),this.boundingBox.expandByPoint(ni.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&An('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new To);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){An("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new $,1/0);return}if(t){const i=this.boundingSphere.center;if(ni.setFromBufferAttribute(t),e)for(let s=0,a=e.length;s<a;s++){const o=e[s];Sr.setFromBufferAttribute(o),this.morphTargetsRelative?(De.addVectors(ni.min,Sr.min),ni.expandByPoint(De),De.addVectors(ni.max,Sr.max),ni.expandByPoint(De)):(ni.expandByPoint(Sr.min),ni.expandByPoint(Sr.max))}ni.getCenter(i);let n=0;for(let s=0,a=t.count;s<a;s++)De.fromBufferAttribute(t,s),n=Math.max(n,i.distanceToSquared(De));if(e)for(let s=0,a=e.length;s<a;s++){const o=e[s],l=this.morphTargetsRelative;for(let h=0,c=o.count;h<c;h++)De.fromBufferAttribute(o,h),l&&(Ls.fromBufferAttribute(t,h),De.add(Ls)),n=Math.max(n,i.distanceToSquared(De))}this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&An('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){An("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=e.position,n=e.normal,s=e.uv;let a=this.getAttribute("tangent");(a===void 0||a.count!==i.count)&&(a=new Ri(new Float32Array(4*i.count),4),this.setAttribute("tangent",a));const o=[],l=[];for(let _=0;_<i.count;_++)o[_]=new $,l[_]=new $;const h=new $,c=new $,d=new $,u=new se,f=new se,p=new se,x=new $,g=new $;function m(_,T,C){h.fromBufferAttribute(i,_),c.fromBufferAttribute(i,T),d.fromBufferAttribute(i,C),u.fromBufferAttribute(s,_),f.fromBufferAttribute(s,T),p.fromBufferAttribute(s,C),c.sub(h),d.sub(h),f.sub(u),p.sub(u);const P=1/(f.x*p.y-p.x*f.y);isFinite(P)&&(x.copy(c).multiplyScalar(p.y).addScaledVector(d,-f.y).multiplyScalar(P),g.copy(d).multiplyScalar(f.x).addScaledVector(c,-p.x).multiplyScalar(P),o[_].add(x),o[T].add(x),o[C].add(x),l[_].add(g),l[T].add(g),l[C].add(g))}let M=this.groups;M.length===0&&(M=[{start:0,count:t.count}]);for(let _=0,T=M.length;_<T;++_){const C=M[_],P=C.start,D=C.count;for(let O=P,H=P+D;O<H;O+=3)m(t.getX(O+0),t.getX(O+1),t.getX(O+2))}const E=new $,v=new $,w=new $,b=new $;function A(_){w.fromBufferAttribute(n,_),b.copy(w);const T=o[_];E.copy(T),E.sub(w.multiplyScalar(w.dot(T))).normalize(),v.crossVectors(b,T);const P=v.dot(l[_])<0?-1:1;a.setXYZW(_,E.x,E.y,E.z,P)}for(let _=0,T=M.length;_<T;++_){const C=M[_],P=C.start,D=C.count;for(let O=P,H=P+D;O<H;O+=3)A(t.getX(O+0)),A(t.getX(O+1)),A(t.getX(O+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==e.count)i=new Ri(new Float32Array(e.count*3),3),this.setAttribute("normal",i);else for(let u=0,f=i.count;u<f;u++)i.setXYZ(u,0,0,0);const n=new $,s=new $,a=new $,o=new $,l=new $,h=new $,c=new $,d=new $;if(t)for(let u=0,f=t.count;u<f;u+=3){const p=t.getX(u+0),x=t.getX(u+1),g=t.getX(u+2);n.fromBufferAttribute(e,p),s.fromBufferAttribute(e,x),a.fromBufferAttribute(e,g),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),o.fromBufferAttribute(i,p),l.fromBufferAttribute(i,x),h.fromBufferAttribute(i,g),o.add(c),l.add(c),h.add(c),i.setXYZ(p,o.x,o.y,o.z),i.setXYZ(x,l.x,l.y,l.z),i.setXYZ(g,h.x,h.y,h.z)}else for(let u=0,f=e.count;u<f;u+=3)n.fromBufferAttribute(e,u+0),s.fromBufferAttribute(e,u+1),a.fromBufferAttribute(e,u+2),c.subVectors(a,s),d.subVectors(n,s),c.cross(d),i.setXYZ(u+0,c.x,c.y,c.z),i.setXYZ(u+1,c.x,c.y,c.z),i.setXYZ(u+2,c.x,c.y,c.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,i=t.count;e<i;e++)De.fromBufferAttribute(t,e),De.normalize(),t.setXYZ(e,De.x,De.y,De.z)}toNonIndexed(){function t(o,l){const h=o.array,c=o.itemSize,d=o.normalized,u=new h.constructor(l.length*c);let f=0,p=0;for(let x=0,g=l.length;x<g;x++){o.isInterleavedBufferAttribute?f=l[x]*o.data.stride+o.offset:f=l[x]*c;for(let m=0;m<c;m++)u[p++]=h[f++]}return new Ri(u,c,d)}if(this.index===null)return Fe("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new Ze,i=this.index.array,n=this.attributes;for(const o in n){const l=n[o],h=t(l,i);e.setAttribute(o,h)}const s=this.morphAttributes;for(const o in s){const l=[],h=s[o];for(let c=0,d=h.length;c<d;c++){const u=h[c],f=t(u,i);l.push(f)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const h=a[o];e.addGroup(h.start,h.count,h.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const l=this.parameters;for(const h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const i=this.attributes;for(const l in i){const h=i[l];t.data.attributes[l]=h.toJSON(t.data)}const n={};let s=!1;for(const l in this.morphAttributes){const h=this.morphAttributes[l],c=[];for(let d=0,u=h.length;d<u;d++){const f=h[d];c.push(f.toJSON(t.data))}c.length>0&&(n[l]=c,s=!0)}s&&(t.data.morphAttributes=n,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const i=t.index;i!==null&&this.setIndex(i.clone());const n=t.attributes;for(const h in n){const c=n[h];this.setAttribute(h,c.clone(e))}const s=t.morphAttributes;for(const h in s){const c=[],d=s[h];for(let u=0,f=d.length;u<f;u++)c.push(d[u].clone(e));this.morphAttributes[h]=c}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let h=0,c=a.length;h<c;h++){const d=a[h];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}}class kv{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=Nh,this.updateRanges=[],this.version=0,this.uuid=Pn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,i){t*=this.stride,i*=e.stride;for(let n=0,s=this.stride;n<s;n++)this.array[t+n]=e.array[i+n];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Pn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),i=new this.constructor(e,this.stride);return i.setUsage(this.usage),i}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Pn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const We=new $;class mo{constructor(t,e,i,n=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=i,this.normalized=n}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,i=this.data.count;e<i;e++)We.fromBufferAttribute(this,e),We.applyMatrix4(t),this.setXYZ(e,We.x,We.y,We.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)We.fromBufferAttribute(this,e),We.applyNormalMatrix(t),this.setXYZ(e,We.x,We.y,We.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)We.fromBufferAttribute(this,e),We.transformDirection(t),this.setXYZ(e,We.x,We.y,We.z);return this}getComponent(t,e){let i=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(i=ki(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=ie(i,this.array)),this.data.array[t*this.data.stride+this.offset+e]=i,this}setX(t,e){return this.normalized&&(e=ie(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=ie(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=ie(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=ie(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=ki(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=ki(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=ki(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=ki(e,this.array)),e}setXY(t,e,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=ie(e,this.array),i=ie(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this}setXYZ(t,e,i,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=ie(e,this.array),i=ie(i,this.array),n=ie(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this.data.array[t+2]=n,this}setXYZW(t,e,i,n,s){return t=t*this.data.stride+this.offset,this.normalized&&(e=ie(e,this.array),i=ie(i,this.array),n=ie(n,this.array),s=ie(s,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this.data.array[t+2]=n,this.data.array[t+3]=s,this}clone(t){if(t===void 0){Ku("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let i=0;i<this.count;i++){const n=i*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[n+s])}return new Ri(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new mo(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){Ku("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let i=0;i<this.count;i++){const n=i*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)e.push(this.data.array[n+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}let Bv=0;class Ao extends lr{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Bv++}),this.uuid=Pn(),this.name="",this.type="Material",this.blending=po,this.side=fo,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Ou,this.blendDst=ku,this.blendEquation=zu,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new oi(0,0,0),this.blendAlpha=0,this.depthFunc=Bu,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=qu,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Ss,this.stencilZFail=Ss,this.stencilZPass=Ss,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const i=t[e];if(i===void 0){Fe(`Material: parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Fe(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}n&&n.isColor?n.set(i):n&&n.isVector2&&i&&i.isVector2||n&&n.isEuler&&i&&i.isEuler||n&&n.isVector3&&i&&i.isVector3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==po&&(i.blending=this.blending),this.side!==fo&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==Ou&&(i.blendSrc=this.blendSrc),this.blendDst!==ku&&(i.blendDst=this.blendDst),this.blendEquation!==zu&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==Bu&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==qu&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Ss&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Ss&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Ss&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function n(s){const a=[];for(const o in s){const l=s[o];delete l.metadata,a.push(l)}return a}if(e){const s=n(t.textures),a=n(t.images);s.length>0&&(i.textures=s),a.length>0&&(i.images=a)}return i}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new oi().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new se().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new se().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let i=null;if(e!==null){const n=e.length;i=new Array(n);for(let s=0;s!==n;++s)i[s]=e[s].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}}class Rf extends Ao{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new oi(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let Ns;const wr=new $,Fs=new $,Us=new $,zs=new se,Er=new se,Cf=new ze,Da=new $,Tr=new $,Ia=new $,hd=new se,Cl=new se,cd=new se;class Vv extends Qe{constructor(t=new Rf){if(super(),this.isSprite=!0,this.type="Sprite",Ns===void 0){Ns=new Ze;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),i=new kv(e,5);Ns.setIndex([0,1,2,0,2,3]),Ns.setAttribute("position",new mo(i,3,0,!1)),Ns.setAttribute("uv",new mo(i,2,3,!1))}this.geometry=Ns,this.material=t,this.center=new se(.5,.5),this.count=1}raycast(t,e){t.camera===null&&An('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Fs.setFromMatrixScale(this.matrixWorld),Cf.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),Us.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Fs.multiplyScalar(-Us.z);const i=this.material.rotation;let n,s;i!==0&&(s=Math.cos(i),n=Math.sin(i));const a=this.center;La(Da.set(-.5,-.5,0),Us,a,Fs,n,s),La(Tr.set(.5,-.5,0),Us,a,Fs,n,s),La(Ia.set(.5,.5,0),Us,a,Fs,n,s),hd.set(0,0),Cl.set(1,0),cd.set(1,1);let o=t.ray.intersectTriangle(Da,Tr,Ia,!1,wr);if(o===null&&(La(Tr.set(-.5,.5,0),Us,a,Fs,n,s),Cl.set(0,1),o=t.ray.intersectTriangle(Da,Ia,Tr,!1,wr),o===null))return;const l=t.ray.origin.distanceTo(wr);l<t.near||l>t.far||e.push({distance:l,point:wr.clone(),uv:fi.getInterpolation(wr,Da,Tr,Ia,hd,Cl,cd,new se),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function La(r,t,e,i,n,s){zs.subVectors(r,e).addScalar(.5).multiply(i),n!==void 0?(Er.x=s*zs.x-n*zs.y,Er.y=n*zs.x+s*zs.y):Er.copy(zs),r.copy(t),r.x+=Er.x,r.y+=Er.y,r.applyMatrix4(Cf)}const tn=new $,Pl=new $,Na=new $,wn=new $,Dl=new $,Fa=new $,Il=new $;class Pf{constructor(t=new $,e=new $(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,tn)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const i=e.dot(this.direction);return i<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=tn.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(tn.copy(this.origin).addScaledVector(this.direction,e),tn.distanceToSquared(t))}distanceSqToSegment(t,e,i,n){Pl.copy(t).add(e).multiplyScalar(.5),Na.copy(e).sub(t).normalize(),wn.copy(this.origin).sub(Pl);const s=t.distanceTo(e)*.5,a=-this.direction.dot(Na),o=wn.dot(this.direction),l=-wn.dot(Na),h=wn.lengthSq(),c=Math.abs(1-a*a);let d,u,f,p;if(c>0)if(d=a*l-o,u=a*o-l,p=s*c,d>=0)if(u>=-p)if(u<=p){const x=1/c;d*=x,u*=x,f=d*(d+a*u+2*o)+u*(a*d+u+2*l)+h}else u=s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u=-s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;else u<=-p?(d=Math.max(0,-(-a*s+o)),u=d>0?-s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h):u<=p?(d=0,u=Math.min(Math.max(-s,-l),s),f=u*(u+2*l)+h):(d=Math.max(0,-(a*s+o)),u=d>0?s:Math.min(Math.max(-s,-l),s),f=-d*d+u*(u+2*l)+h);else u=a>0?-s:s,d=Math.max(0,-(a*u+o)),f=-d*d+u*(u+2*l)+h;return i&&i.copy(this.origin).addScaledVector(this.direction,d),n&&n.copy(Pl).addScaledVector(Na,u),f}intersectSphere(t,e){tn.subVectors(t.center,this.origin);const i=tn.dot(this.direction),n=tn.dot(tn)-i*i,s=t.radius*t.radius;if(n>s)return null;const a=Math.sqrt(s-n),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(t.normal)+t.constant)/e;return i>=0?i:null}intersectPlane(t,e){const i=this.distanceToPlane(t);return i===null?null:this.at(i,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let i,n,s,a,o,l;const h=1/this.direction.x,c=1/this.direction.y,d=1/this.direction.z,u=this.origin;return h>=0?(i=(t.min.x-u.x)*h,n=(t.max.x-u.x)*h):(i=(t.max.x-u.x)*h,n=(t.min.x-u.x)*h),c>=0?(s=(t.min.y-u.y)*c,a=(t.max.y-u.y)*c):(s=(t.max.y-u.y)*c,a=(t.min.y-u.y)*c),i>a||s>n||((s>i||isNaN(i))&&(i=s),(a<n||isNaN(n))&&(n=a),d>=0?(o=(t.min.z-u.z)*d,l=(t.max.z-u.z)*d):(o=(t.max.z-u.z)*d,l=(t.min.z-u.z)*d),i>l||o>n)||((o>i||i!==i)&&(i=o),(l<n||n!==n)&&(n=l),n<0)?null:this.at(i>=0?i:n,e)}intersectsBox(t){return this.intersectBox(t,tn)!==null}intersectTriangle(t,e,i,n,s){Dl.subVectors(e,t),Fa.subVectors(i,t),Il.crossVectors(Dl,Fa);let a=this.direction.dot(Il),o;if(a>0){if(n)return null;o=1}else if(a<0)o=-1,a=-a;else return null;wn.subVectors(this.origin,t);const l=o*this.direction.dot(Fa.crossVectors(wn,Fa));if(l<0)return null;const h=o*this.direction.dot(Dl.cross(wn));if(h<0||l+h>a)return null;const c=-o*wn.dot(Il);return c<0?null:this.at(c/a,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Df extends Ao{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new oi(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new jn,this.combine=fv,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const ud=new ze,Wn=new Pf,Ua=new To,dd=new $,za=new $,Oa=new $,ka=new $,Ll=new $,Ba=new $,fd=new $,Va=new $;class Le extends Qe{constructor(t=new Ze,e=new Df){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=n.length;s<a;s++){const o=n[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(t,e){const i=this.geometry,n=i.attributes.position,s=i.morphAttributes.position,a=i.morphTargetsRelative;e.fromBufferAttribute(n,t);const o=this.morphTargetInfluences;if(s&&o){Ba.set(0,0,0);for(let l=0,h=s.length;l<h;l++){const c=o[l],d=s[l];c!==0&&(Ll.fromBufferAttribute(d,t),a?Ba.addScaledVector(Ll,c):Ba.addScaledVector(Ll.sub(e),c))}e.add(Ba)}return e}raycast(t,e){const i=this.geometry,n=this.material,s=this.matrixWorld;n!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Ua.copy(i.boundingSphere),Ua.applyMatrix4(s),Wn.copy(t.ray).recast(t.near),!(Ua.containsPoint(Wn.origin)===!1&&(Wn.intersectSphere(Ua,dd)===null||Wn.origin.distanceToSquared(dd)>(t.far-t.near)**2))&&(ud.copy(s).invert(),Wn.copy(t.ray).applyMatrix4(ud),!(i.boundingBox!==null&&Wn.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,e,Wn)))}_computeIntersections(t,e,i){let n;const s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,h=s.attributes.uv,c=s.attributes.uv1,d=s.attributes.normal,u=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const g=u[p],m=a[g.materialIndex],M=Math.max(g.start,f.start),E=Math.min(o.count,Math.min(g.start+g.count,f.start+f.count));for(let v=M,w=E;v<w;v+=3){const b=o.getX(v),A=o.getX(v+1),_=o.getX(v+2);n=Ga(this,m,t,i,h,c,d,b,A,_),n&&(n.faceIndex=Math.floor(v/3),n.face.materialIndex=g.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(o.count,f.start+f.count);for(let g=p,m=x;g<m;g+=3){const M=o.getX(g),E=o.getX(g+1),v=o.getX(g+2);n=Ga(this,a,t,i,h,c,d,M,E,v),n&&(n.faceIndex=Math.floor(g/3),e.push(n))}}else if(l!==void 0)if(Array.isArray(a))for(let p=0,x=u.length;p<x;p++){const g=u[p],m=a[g.materialIndex],M=Math.max(g.start,f.start),E=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let v=M,w=E;v<w;v+=3){const b=v,A=v+1,_=v+2;n=Ga(this,m,t,i,h,c,d,b,A,_),n&&(n.faceIndex=Math.floor(v/3),n.face.materialIndex=g.materialIndex,e.push(n))}}else{const p=Math.max(0,f.start),x=Math.min(l.count,f.start+f.count);for(let g=p,m=x;g<m;g+=3){const M=g,E=g+1,v=g+2;n=Ga(this,a,t,i,h,c,d,M,E,v),n&&(n.faceIndex=Math.floor(g/3),e.push(n))}}}}function Gv(r,t,e,i,n,s,a,o){let l;if(t.side===dv?l=i.intersectTriangle(a,s,n,!0,o):l=i.intersectTriangle(n,s,a,t.side===fo,o),l===null)return null;Va.copy(o),Va.applyMatrix4(r.matrixWorld);const h=e.ray.origin.distanceTo(Va);return h<e.near||h>e.far?null:{distance:h,point:Va.clone(),object:r}}function Ga(r,t,e,i,n,s,a,o,l,h){r.getVertexPosition(o,za),r.getVertexPosition(l,Oa),r.getVertexPosition(h,ka);const c=Gv(r,t,e,i,za,Oa,ka,fd);if(c){const d=new $;fi.getBarycoord(fd,za,Oa,ka,d),n&&(c.uv=fi.getInterpolatedAttribute(n,o,l,h,d,new se)),s&&(c.uv1=fi.getInterpolatedAttribute(s,o,l,h,d,new se)),a&&(c.normal=fi.getInterpolatedAttribute(a,o,l,h,d,new $),c.normal.dot(i.direction)>0&&c.normal.multiplyScalar(-1));const u={a:o,b:l,c:h,normal:new $,materialIndex:0};fi.getNormal(za,Oa,ka,u.normal),c.face=u,c.barycoord=d}return c}class Hv extends Ao{constructor(t){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new oi(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}const pd=new ze,Fh=new Pf,Ha=new To,Wa=new $;class Nl extends Qe{constructor(t=new Ze,e=new Hv){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}raycast(t,e){const i=this.geometry,n=this.matrixWorld,s=t.params.Points.threshold,a=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),Ha.copy(i.boundingSphere),Ha.applyMatrix4(n),Ha.radius+=s,t.ray.intersectsSphere(Ha)===!1)return;pd.copy(n).invert(),Fh.copy(t.ray).applyMatrix4(pd);const o=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,h=i.index,d=i.attributes.position;if(h!==null){const u=Math.max(0,a.start),f=Math.min(h.count,a.start+a.count);for(let p=u,x=f;p<x;p++){const g=h.getX(p);Wa.fromBufferAttribute(d,g),md(Wa,g,l,n,t,e,this)}}else{const u=Math.max(0,a.start),f=Math.min(d.count,a.start+a.count);for(let p=u,x=f;p<x;p++)Wa.fromBufferAttribute(d,p),md(Wa,p,l,n,t,e,this)}}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=n.length;s<a;s++){const o=n[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}}function md(r,t,e,i,n,s,a){const o=Fh.distanceSqToPoint(r);if(o<e){const l=new $;Fh.closestPointToPoint(r,l),l.applyMatrix4(i);const h=n.ray.origin.distanceTo(l);if(h<n.near||h>n.far)return;s.push({distance:h,distanceToRay:Math.sqrt(o),point:l,index:t,face:null,faceIndex:null,barycoord:null,object:a})}}class Wv extends on{constructor(t,e,i,n,s,a,o,l,h){super(t,e,i,n,s,a,o,l,h),this.isCanvasTexture=!0,this.needsUpdate=!0}}class lc extends Ze{constructor(t=1,e=1,i=4,n=8,s=1){super(),this.type="CapsuleGeometry",this.parameters={radius:t,height:e,capSegments:i,radialSegments:n,heightSegments:s},e=Math.max(0,e),i=Math.max(1,Math.floor(i)),n=Math.max(3,Math.floor(n)),s=Math.max(1,Math.floor(s));const a=[],o=[],l=[],h=[],c=e/2,d=Math.PI/2*t,u=e,f=2*d+u,p=i*2+s,x=n+1,g=new $,m=new $;for(let M=0;M<=p;M++){let E=0,v=0,w=0,b=0;if(M<=i){const T=M/i,C=T*Math.PI/2;v=-c-t*Math.cos(C),w=t*Math.sin(C),b=-t*Math.cos(C),E=T*d}else if(M<=i+s){const T=(M-i)/s;v=-c+T*e,w=t,b=0,E=d+T*u}else{const T=(M-i-s)/i,C=T*Math.PI/2;v=c+t*Math.sin(C),w=t*Math.cos(C),b=t*Math.sin(C),E=d+u+T*d}const A=Math.max(0,Math.min(1,E/f));let _=0;M===0?_=.5/n:M===p&&(_=-.5/n);for(let T=0;T<=n;T++){const C=T/n,P=C*Math.PI*2,D=Math.sin(P),O=Math.cos(P);m.x=-w*O,m.y=v,m.z=w*D,o.push(m.x,m.y,m.z),g.set(-w*O,b,w*D),g.normalize(),l.push(g.x,g.y,g.z),h.push(C+_,A)}if(M>0){const T=(M-1)*x;for(let C=0;C<n;C++){const P=T+C,D=T+C+1,O=M*x+C,H=M*x+C+1;a.push(P,D,O),a.push(D,H,O)}}}this.setIndex(a),this.setAttribute("position",new Te(o,3)),this.setAttribute("normal",new Te(l,3)),this.setAttribute("uv",new Te(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new lc(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}}class Zr extends Ze{constructor(t=1,e=1,i=1,n=32,s=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:i,radialSegments:n,heightSegments:s,openEnded:a,thetaStart:o,thetaLength:l};const h=this;n=Math.floor(n),s=Math.floor(s);const c=[],d=[],u=[],f=[];let p=0;const x=[],g=i/2;let m=0;M(),a===!1&&(t>0&&E(!0),e>0&&E(!1)),this.setIndex(c),this.setAttribute("position",new Te(d,3)),this.setAttribute("normal",new Te(u,3)),this.setAttribute("uv",new Te(f,2));function M(){const v=new $,w=new $;let b=0;const A=(e-t)/i;for(let _=0;_<=s;_++){const T=[],C=_/s,P=C*(e-t)+t;for(let D=0;D<=n;D++){const O=D/n,H=O*l+o,F=Math.sin(H),q=Math.cos(H);w.x=P*F,w.y=-C*i+g,w.z=P*q,d.push(w.x,w.y,w.z),v.set(F,A,q).normalize(),u.push(v.x,v.y,v.z),f.push(O,1-C),T.push(p++)}x.push(T)}for(let _=0;_<n;_++)for(let T=0;T<s;T++){const C=x[T][_],P=x[T+1][_],D=x[T+1][_+1],O=x[T][_+1];(t>0||T!==0)&&(c.push(C,P,O),b+=3),(e>0||T!==s-1)&&(c.push(P,D,O),b+=3)}h.addGroup(m,b,0),m+=b}function E(v){const w=p,b=new se,A=new $;let _=0;const T=v===!0?t:e,C=v===!0?1:-1;for(let D=1;D<=n;D++)d.push(0,g*C,0),u.push(0,C,0),f.push(.5,.5),p++;const P=p;for(let D=0;D<=n;D++){const H=D/n*l+o,F=Math.cos(H),q=Math.sin(H);A.x=T*q,A.y=g*C,A.z=T*F,d.push(A.x,A.y,A.z),u.push(0,C,0),b.x=F*.5+.5,b.y=q*.5*C+.5,f.push(b.x,b.y),p++}for(let D=0;D<n;D++){const O=w+D,H=P+D;v===!0?c.push(H,H+1,O):c.push(H+1,H,O),_+=3}h.addGroup(m,_,v===!0?1:2),m+=_}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Zr(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Vi extends Zr{constructor(t=1,e=1,i=32,n=1,s=!1,a=0,o=Math.PI*2){super(0,t,e,i,n,s,a,o),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:i,heightSegments:n,openEnded:s,thetaStart:a,thetaLength:o}}static fromJSON(t){return new Vi(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class hc extends Ze{constructor(t=[],e=[],i=1,n=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:i,detail:n};const s=[],a=[];o(n),h(i),c(),this.setAttribute("position",new Te(s,3)),this.setAttribute("normal",new Te(s.slice(),3)),this.setAttribute("uv",new Te(a,2)),n===0?this.computeVertexNormals():this.normalizeNormals();function o(M){const E=new $,v=new $,w=new $;for(let b=0;b<e.length;b+=3)f(e[b+0],E),f(e[b+1],v),f(e[b+2],w),l(E,v,w,M)}function l(M,E,v,w){const b=w+1,A=[];for(let _=0;_<=b;_++){A[_]=[];const T=M.clone().lerp(v,_/b),C=E.clone().lerp(v,_/b),P=b-_;for(let D=0;D<=P;D++)D===0&&_===b?A[_][D]=T:A[_][D]=T.clone().lerp(C,D/P)}for(let _=0;_<b;_++)for(let T=0;T<2*(b-_)-1;T++){const C=Math.floor(T/2);T%2===0?(u(A[_][C+1]),u(A[_+1][C]),u(A[_][C])):(u(A[_][C+1]),u(A[_+1][C+1]),u(A[_+1][C]))}}function h(M){const E=new $;for(let v=0;v<s.length;v+=3)E.x=s[v+0],E.y=s[v+1],E.z=s[v+2],E.normalize().multiplyScalar(M),s[v+0]=E.x,s[v+1]=E.y,s[v+2]=E.z}function c(){const M=new $;for(let E=0;E<s.length;E+=3){M.x=s[E+0],M.y=s[E+1],M.z=s[E+2];const v=g(M)/2/Math.PI+.5,w=m(M)/Math.PI+.5;a.push(v,1-w)}p(),d()}function d(){for(let M=0;M<a.length;M+=6){const E=a[M+0],v=a[M+2],w=a[M+4],b=Math.max(E,v,w),A=Math.min(E,v,w);b>.9&&A<.1&&(E<.2&&(a[M+0]+=1),v<.2&&(a[M+2]+=1),w<.2&&(a[M+4]+=1))}}function u(M){s.push(M.x,M.y,M.z)}function f(M,E){const v=M*3;E.x=t[v+0],E.y=t[v+1],E.z=t[v+2]}function p(){const M=new $,E=new $,v=new $,w=new $,b=new se,A=new se,_=new se;for(let T=0,C=0;T<s.length;T+=9,C+=6){M.set(s[T+0],s[T+1],s[T+2]),E.set(s[T+3],s[T+4],s[T+5]),v.set(s[T+6],s[T+7],s[T+8]),b.set(a[C+0],a[C+1]),A.set(a[C+2],a[C+3]),_.set(a[C+4],a[C+5]),w.copy(M).add(E).add(v).divideScalar(3);const P=g(w);x(b,C+0,M,P),x(A,C+2,E,P),x(_,C+4,v,P)}}function x(M,E,v,w){w<0&&M.x===1&&(a[E]=M.x-1),v.x===0&&v.z===0&&(a[E]=w/2/Math.PI+.5)}function g(M){return Math.atan2(M.z,-M.x)}function m(M){return Math.atan2(-M.y,Math.sqrt(M.x*M.x+M.z*M.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new hc(t.vertices,t.indices,t.radius,t.detail)}}class go extends hc{constructor(t=1,e=0){const i=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],n=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(i,n,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new go(t.radius,t.detail)}}class Ro extends Ze{constructor(t=1,e=1,i=1,n=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:i,heightSegments:n};const s=t/2,a=e/2,o=Math.floor(i),l=Math.floor(n),h=o+1,c=l+1,d=t/o,u=e/l,f=[],p=[],x=[],g=[];for(let m=0;m<c;m++){const M=m*u-a;for(let E=0;E<h;E++){const v=E*d-s;p.push(v,-M,0),x.push(0,0,1),g.push(E/o),g.push(1-m/l)}}for(let m=0;m<l;m++)for(let M=0;M<o;M++){const E=M+h*m,v=M+h*(m+1),w=M+1+h*(m+1),b=M+1+h*m;f.push(E,v,b),f.push(v,w,b)}this.setIndex(f),this.setAttribute("position",new Te(p,3)),this.setAttribute("normal",new Te(x,3)),this.setAttribute("uv",new Te(g,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Ro(t.width,t.height,t.widthSegments,t.heightSegments)}}class di extends Ze{constructor(t=1,e=32,i=16,n=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:i,phiStart:n,phiLength:s,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),i=Math.max(2,Math.floor(i));const l=Math.min(a+o,Math.PI);let h=0;const c=[],d=new $,u=new $,f=[],p=[],x=[],g=[];for(let m=0;m<=i;m++){const M=[],E=m/i,v=a+E*o,w=t*Math.cos(v),b=Math.sqrt(t*t-w*w);let A=0;m===0&&a===0?A=.5/e:m===i&&l===Math.PI&&(A=-.5/e);for(let _=0;_<=e;_++){const T=_/e,C=n+T*s;d.x=-b*Math.cos(C),d.y=w,d.z=b*Math.sin(C),p.push(d.x,d.y,d.z),u.copy(d).normalize(),x.push(u.x,u.y,u.z),g.push(T+A,1-E),M.push(h++)}c.push(M)}for(let m=0;m<i;m++)for(let M=0;M<e;M++){const E=c[m][M+1],v=c[m][M],w=c[m+1][M],b=c[m+1][M+1];(m!==0||a>0)&&f.push(E,v,b),(m!==i-1||l<Math.PI)&&f.push(v,w,b)}this.setIndex(f),this.setAttribute("position",new Te(p,3)),this.setAttribute("normal",new Te(x,3)),this.setAttribute("uv",new Te(g,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new di(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class xo extends Ze{constructor(t=1,e=.4,i=12,n=48,s=Math.PI*2,a=0,o=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:i,tubularSegments:n,arc:s,thetaStart:a,thetaLength:o},i=Math.floor(i),n=Math.floor(n);const l=[],h=[],c=[],d=[],u=new $,f=new $,p=new $;for(let x=0;x<=i;x++){const g=a+x/i*o;for(let m=0;m<=n;m++){const M=m/n*s;f.x=(t+e*Math.cos(g))*Math.cos(M),f.y=(t+e*Math.cos(g))*Math.sin(M),f.z=e*Math.sin(g),h.push(f.x,f.y,f.z),u.x=t*Math.cos(M),u.y=t*Math.sin(M),p.subVectors(f,u).normalize(),c.push(p.x,p.y,p.z),d.push(m/n),d.push(x/i)}}for(let x=1;x<=i;x++)for(let g=1;g<=n;g++){const m=(n+1)*x+g-1,M=(n+1)*(x-1)+g-1,E=(n+1)*(x-1)+g,v=(n+1)*x+g;l.push(m,M,v),l.push(M,E,v)}this.setIndex(l),this.setAttribute("position",new Te(h,3)),this.setAttribute("normal",new Te(c,3)),this.setAttribute("uv",new Te(d,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new xo(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}}function Xv(r){const t={};for(const e in r){t[e]={};for(const i in r[e]){const n=r[e][i];if(gd(n))n.isRenderTargetTexture?(Fe("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][i]=null):t[e][i]=n.clone();else if(Array.isArray(n))if(gd(n[0])){const s=[];for(let a=0,o=n.length;a<o;a++)s[a]=n[a].clone();t[e][i]=s}else t[e][i]=n.slice();else t[e][i]=n}}return t}function gd(r){return r&&(r.isColor||r.isMatrix3||r.isMatrix4||r.isVector2||r.isVector3||r.isVector4||r.isTexture||r.isQuaternion)}function qv(r){const t=[];for(let e=0;e<r.length;e++)t.push(r[e].clone());return t}var $v=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Yv=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class qr extends Ao{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=$v,this.fragmentShader=Yv,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Xv(t.uniforms),this.uniformsGroups=qv(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const n in this.uniforms){const a=this.uniforms[n].value;a&&a.isTexture?e.uniforms[n]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[n]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[n]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[n]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[n]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[n]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[n]={type:"m4",value:a.toArray()}:e.uniforms[n]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const i={};for(const n in this.extensions)this.extensions[n]===!0&&(i[n]=!0);return Object.keys(i).length>0&&(e.extensions=i),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const i in t.uniforms){const n=t.uniforms[i];switch(this.uniforms[i]={},n.type){case"t":this.uniforms[i].value=e[n.value]||null;break;case"c":this.uniforms[i].value=new oi().setHex(n.value);break;case"v2":this.uniforms[i].value=new se().fromArray(n.value);break;case"v3":this.uniforms[i].value=new $().fromArray(n.value);break;case"v4":this.uniforms[i].value=new Wi().fromArray(n.value);break;case"m3":this.uniforms[i].value=new cn().fromArray(n.value);break;case"m4":this.uniforms[i].value=new ze().fromArray(n.value);break;default:this.uniforms[i].value=n.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}}const Xa=new $,qa=new hr,Ui=new $;class Zv extends Qe{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ze,this.projectionMatrix=new ze,this.projectionMatrixInverse=new ze,this.coordinateSystem=Ir,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(Xa,qa,Ui),Ui.x===1&&Ui.y===1&&Ui.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Xa,qa,Ui.set(1,1,1)).invert()}updateWorldMatrix(t,e,i=!1){super.updateWorldMatrix(t,e,i),this.matrixWorld.decompose(Xa,qa,Ui),Ui.x===1&&Ui.y===1&&Ui.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Xa,qa,Ui.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}}class Kv extends Zv{constructor(t=-1,e=1,i=1,n=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=i,this.bottom=n,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,i,n,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,n=(this.top+this.bottom)/2;let s=i-t,a=i+t,o=n+e,l=n-e;if(this.view!==null&&this.view.enabled){const h=(this.right-this.left)/this.view.fullWidth/this.zoom,c=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=h*this.view.offsetX,a=s+h*this.view.width,o-=c*this.view.offsetY,l=o-c*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}class If{static{If.prototype.isMatrix2=!0}constructor(t,e,i,n){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,i,n)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let i=0;i<4;i++)this.elements[i]=t[i+e];return this}set(t,e,i,n){const s=this.elements;return s[0]=t,s[2]=e,s[1]=i,s[3]=n,this}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:bf}}));typeof window<"u"&&(window.__THREE__?Fe("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=bf);const xd=`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`,Jv=`
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
`,Qv=`
  uniform sampler2D tNear;
  uniform sampler2D tWide;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tNear, vUv).rgb * 0.65 + texture2D(tWide, vUv).rgb * 0.55;
    gl_FragColor = vec4(c * uStrength, 1.0);
  }
`;class jv{constructor(t,{strength:e=.9,threshold:i=.32,knee:n=.35,scale:s=.25}={}){this.renderer=t,this.enabled=!0,this.scale=s;const a=()=>new td(1,1,{type:Hu,depthBuffer:!1,generateMipmaps:!1});this.scene=new td(1,1,{type:Hu,generateMipmaps:!1}),this.a=a(),this.b=a(),this.c=a(),this.d=a(),this.blur=new qr({vertexShader:xd,fragmentShader:Jv,uniforms:{tSrc:{value:null},uDir:{value:new se},uThreshold:{value:i},uKnee:{value:n}},depthTest:!1,depthWrite:!1}),this.composite=new qr({vertexShader:xd,fragmentShader:Qv,uniforms:{tNear:{value:this.b.texture},tWide:{value:this.d.texture},uStrength:{value:e}},depthTest:!1,depthWrite:!1,transparent:!0,blending:Qn}),this.threshold=i,this.quad=new Le(new Ro(2,2),this.blur),this.quad.frustumCulled=!1,this.quadScene=new Lv,this.quadScene.add(this.quad),this.quadCam=new Kv(-1,1,1,-1,0,1),this.size=new se,this.w=0,this.h=0}#t(){this.renderer.getSize(this.size);const t=Math.max(16,Math.round(this.size.x*this.scale)),e=Math.max(16,Math.round(this.size.y*this.scale));t===this.w&&e===this.h||(this.w=t,this.h=e,this.scene.setSize(t,e),this.a.setSize(t,e),this.b.setSize(t,e),this.c.setSize(Math.max(8,t>>1),Math.max(8,e>>1)),this.d.setSize(Math.max(8,t>>1),Math.max(8,e>>1)))}#i(t,e,i){i(),this.quad.material=t,this.renderer.setRenderTarget(e),this.renderer.render(this.quadScene,this.quadCam)}apply(t,e,i){if(!this.enabled)return;const n=this.renderer,s=n.getRenderTarget(),a=n.autoClear;this.#t(),n.setRenderTarget(this.scene),n.autoClear=!0,t(e,i);const o=this.blur.uniforms;this.#i(this.blur,this.a,()=>{o.tSrc.value=this.scene.texture,o.uDir.value.set(1.4/this.w,0),o.uThreshold.value=this.threshold}),this.#i(this.blur,this.b,()=>{o.tSrc.value=this.a.texture,o.uDir.value.set(0,1.4/this.h),o.uThreshold.value=0}),this.#i(this.blur,this.c,()=>{o.tSrc.value=this.b.texture,o.uDir.value.set(2.2/this.c.width,0),o.uThreshold.value=0}),this.#i(this.blur,this.d,()=>{o.tSrc.value=this.c.texture,o.uDir.value.set(0,2.2/this.c.height),o.uThreshold.value=0}),n.setRenderTarget(s),n.autoClear=!1,this.quad.material=this.composite,n.render(this.quadScene,this.quadCam),n.autoClear=a}dispose(){for(const t of[this.scene,this.a,this.b,this.c,this.d])t.dispose();this.blur.dispose(),this.composite.dispose(),this.quad.geometry.dispose()}}function tM(r,t,e){const i=new jv(r,e),n=r.render.bind(r);let s=!1;return r.render=(a,o)=>{if(n(a,o),!(s||a!==t||!i.enabled||r.getRenderTarget()!==null)){s=!0;try{i.apply(n,a,o)}finally{s=!1}}},i}const Bt=2,Js=.5,_d=Bt/Js,eM=1,Xn=1,Qs=Object.freeze({player:Object.freeze({radius:.32,height:.55}),beast:Object.freeze({radius:.48,height:1.05}),great:Object.freeze({radius:.7,height:1.6})});function $e(r,t,e=0){let i=r*374761393+t*668265263+e*1442695041|0;return i=Math.imul(i^i>>>13,1274126177),i^=i>>>16,(i>>>0)/4294967295}function yd(r){return r*r*(3-2*r)}function zr(r,t,e=0){const i=Math.floor(r),n=Math.floor(t),s=yd(r-i),a=yd(t-n),o=$e(i,n,e),l=$e(i+1,n,e),h=$e(i,n+1,e),c=$e(i+1,n+1,e);return o+(l-o)*s+(h-o)*a+(o-l-h+c)*s*a}function iM(r,t,e){const i=Math.min(1,Math.max(0,(e-r)/(t-r)));return i*i*(3-2*i)}function cc(r,t,e){const[i,n,s,a]=r.rect;return t>=i*Bt&&t<(s+1)*Bt&&e>=n*Bt&&e<(a+1)*Bt}function nM(r,t,e){const[i,n,s,a]=r.rect,o=i*Bt,l=(s+1)*Bt,h=n*Bt,c=(a+1)*Bt;let d;return r.dir==="n"?d=(c-e)/(c-h):r.dir==="s"?d=(e-h)/(c-h):r.dir==="e"?d=(t-o)/(l-o):d=(l-t)/(l-o),d=Math.min(1,Math.max(0,d)),r.from+(r.to-r.from)*d}function Fl(r,t,e,i,n){for(const s of r.floor??[])!!s.sharp!==n||!cc(s,t,e)||(s.ramp?i=nM(s,t,e):s.add!==void 0?i+=s.add:i=s.h);return i}const sM=[-2,-1,0,1,2].flatMap(r=>[-2,-1,0,1,2].map(t=>[r*.9,t*.9]));function rM(r,t,e,i=null){const n=r.floorBase??0;let s=0,a=0;for(const[l,h]of sM){const c=t+l,d=e+h;i&&!i(c,d)||(r.floor??[]).some(u=>u.sharp&&cc(u,c,d))||(s+=Fl(r,c,d,n,!1),a+=1)}const o=a?s/a:Fl(r,t,e,n,!1);return Fl(r,t,e,o,!0)}function aM(r,t,e,i){let n=r.clear??3.4,s=null;for(const c of r.ceil??[])cc(c,t,e)&&(c.ceil!==void 0?s=c.ceil:c.clear!==void 0&&(n=c.clear,s=null));const a=s??i+n,o=a-i,l=(r.ceilVar??.8)*Math.min(1,Math.max(.06,(o-.8)/2.2)),h=(zr(t*.32,e*.32,31)-.5)*2+(zr(t*.9,e*.9,37)-.5)*.6;return a+h*l}function oM(r){const{width:t,height:e,solid:i,def:n}=r,s=t*_d+1,a=e*_d+1,o=new Float32Array(s*a),l=new Float32Array(s*a),h=new Float32Array(s*a),c=(p,x)=>p<0||x<0||p>=t||x>=e||i[x*t+p]===1,d=n.water?.depth??.3,u=(p,x)=>!c(Math.floor(p/Bt),Math.floor(x/Bt));for(let p=0;p<a;p+=1)for(let x=0;x<s;x+=1){const g=x*Js,m=p*Js,M=Math.floor(g/Bt),E=Math.floor(m/Bt);let v=9,w=9,b=g,A=m;for(let G=E-3;G<=E+3;G+=1)for(let J=M-3;J<=M+3;J+=1){const et=Math.max(J*Bt-g,0,g-(J+1)*Bt),at=Math.max(G*Bt-m,0,m-(G+1)*Bt),rt=Math.hypot(et,at);c(J,G)?rt<v&&(v=rt):rt<w&&(w=rt,b=Math.min(Math.max(g,J*Bt+.01),(J+1)*Bt-.01),A=Math.min(Math.max(m,G*Bt+.01),(G+1)*Bt-.01))}const _=v>0?v:-w,T=(zr(g*.55,m*.55,11)-.5)*.36+(zr(g*1.4,m*1.4,13)-.5)*.16,C=iM(.12,-.7,_+T),P=w>0?b:g,D=w>0?A:m;let O=rM(n,P,D,u)+(zr(g*.7,m*.7,5)-.5)*.08;r.water&&Lf(r,P,D)&&(O-=d);const H=aM(n,P,D,O),F=O+(H-O)*.42,q=p*s+x;h[q]=C,o[q]=O+C*(F-O),l[q]=H-C*(H-F)}const f={nx:s,nz:a,F:o,C:l,K:h,width:t,height:e,cell:Bt,res:Js,level:r,waterY:n.water?.y??null};return f.stalagmites=uM(f),f.stalactites=dM(f),f}function Lf(r,t,e){if(!r.water)return!1;const i=Math.floor(t/Bt),n=Math.floor(e/Bt);return i<0||n<0||i>=r.width||n>=r.height?!1:r.water[n*r.width+i]===1}function Nf(r,t,e,i,n){const s=e/Js,a=i/Js,o=Math.floor(s),l=Math.floor(a);if(o<0||l<0||o>=r.nx-1||l>=r.nz-1)return n;const h=s-o,c=a-l,d=l*r.nx+o,u=t[d],f=t[d+r.nx+1];if(h>=c){const x=t[d+1];return u+h*(x-u)+c*(f-x)}const p=t[d+r.nx];return u+c*(p-u)+h*(f-p)}function mi(r,t,e){return Nf(r,r.F,t,e,999)}function sr(r,t,e){return Nf(r,r.C,t,e,-999)}function Ff(r,t,e,i,n=0){const s=mi(r,t,i),a=sr(r,t,i);return a-s>2*n&&e>s+n&&e<a-n}const lM=Array.from({length:16},(r,t)=>[Math.cos(t/16*Math.PI*2),Math.sin(t/16*Math.PI*2)]);function _o(r,t,e,i,n,s=0,a=0){if(sr(r,t,e)-i<n.height)return!0;const o=s!==0||a!==0,l=n.radius,h=l*eM;for(const[c,d]of lM){if(o&&c*s+d*a<.2)continue;const u=t+c*l,f=e+d*l;if(mi(r,u,f)-i>h||sr(r,u,f)-i<n.height)return!0}return!1}function hM(r,t){const e=(t-r.y)/r.height;return e>=1?0:r.radius*(1-Math.max(0,e))}function Uf(r,t,e,i,n){const s=i+Math.min(n.height,1)*.45;let a=0,o=0,l=!1;for(const h of r.stalagmites){const c=t-h.x,d=e-h.z;if(Math.abs(c)>2||Math.abs(d)>2)continue;const u=hM(h,s)+n.radius;if(u<=n.radius)continue;const f=Math.hypot(c,d);if(f>=u)continue;l=!0;const p=(u-f)/Math.max(f,1e-6);a+=f>1e-6?c*p:u,o+=f>1e-6?d*p:0}return l?{px:a,pz:o}:null}function vd(r,t,e,i,n){return Uf(r,t,e,i,n)!==null}function Md(r,t,e,i,n){const s=(l,h)=>{const c=Math.hypot(l,h);if(c<1e-7)return!1;const d=t.x+l,u=t.z+h,f=mi(r,d,u);return _o(r,d,u,f,n,l/c,h/c)?!1:(t.x=d,t.z=u,t.y=f,!0)};let a=s(e,i);if(!a){const l=s(e,0),h=s(0,i);a=l||h;for(let c=.5;!a&&c>.03;c/=2)a=s(e*c,i*c)}const o=Uf(r,t.x,t.z,t.y,n);if(o){const l=t.x+o.px,h=t.z+o.pz,c=Math.hypot(o.px,o.pz)||1,d=mi(r,l,h);_o(r,l,h,d,n,o.px/c,o.pz/c)?a&&(t.x-=e,t.z-=i,t.y=mi(r,t.x,t.z)):(t.x=l,t.z=h,t.y=d)}return a}function cM(r,t,e){const i=r.def.rows[e]?.[t];return i!==void 0&&i!=="."&&i!=="#"&&i!=="~"}function uM(r){const{level:t}=r,e=[],i=(n,s)=>!(n<0||s<0||n>=t.width||s>=t.height||t.solid[s*t.width+n]);for(let n=1;n<t.height-1;n+=1)for(let s=1;s<t.width-1;s+=1){if(!i(s,n)||cM(t,s,n)||t.water&&t.water[n*t.width+s])continue;const a=i(s-1,n)?i(s+1,n)?0:1:-1,o=i(s,n-1)?i(s,n+1)?0:1:-1;let l,h;if(a&&o&&$e(s,n,9)<.5)l=(s+.5)*Bt+a*.62,h=(n+.5)*Bt+o*.62;else{let u=!0;for(let f=-1;f<=1;f+=1)for(let p=-1;p<=1;p+=1)i(s+p,n+f)||(u=!1);if(!u||$e(s,n,19)>.1)continue;l=(s+.5)*Bt+($e(s,n,20)-.5)*.8,h=(n+.5)*Bt+($e(s,n,21)-.5)*.8}const c=mi(r,l,h),d=sr(r,l,h)-c;d<1.2||e.push({x:l,z:h,y:c-.05,radius:.2+$e(s,n,10)*.2,height:Math.min(d-.3,.6+$e(s,n,11)*1.1),id:`stalagmite_${e.length}`})}return e}function dM(r){const{level:t}=r,e=[];for(let i=1;i<t.height-1;i+=1)for(let n=1;n<t.width-1;n+=1){if(t.solid[i*t.width+n]||$e(n,i,41)>.32)continue;const s=(n+.5)*Bt+($e(n,i,42)-.5)*1.2,a=(i+.5)*Bt+($e(n,i,43)-.5)*1.2,o=sr(r,s,a),l=o-mi(r,s,a),h=.3+$e(n,i,44)*1.1;l-h<1.9||e.push({x:s,z:a,y:o+.05,radius:.12+$e(n,i,45)*.16,length:h})}return e}const Uh=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];function Ul(r,t){const e=Math.floor(r.width*Bt/Xn)-1,i=Math.floor(r.height*Bt/Xn)-1,n=new Uint8Array(e*i),s=new Uint8Array(e*i),a=o=>(o+1)*Xn;for(let o=0;o<i;o+=1)for(let l=0;l<e;l+=1){const h=a(l),c=a(o),d=mi(r,h,c);n[o*e+l]=!_o(r,h,c,d,t)&&!vd(r,h,c,d,t)?1:0}for(let o=0;o<i;o+=1)for(let l=0;l<e;l+=1){if(!n[o*e+l])continue;let h=0;Uh.forEach(([c,d],u)=>{const f=l+c,p=o+d;if(f<0||p<0||f>=e||p>=i||!n[p*e+f])return;const x=Math.hypot(c,d),g=c/x,m=d/x,M=Math.ceil(x*Xn/.15);for(let E=1;E<=M;E+=1){const v=E/M,w=a(l)+c*Xn*v,b=a(o)+d*Xn*v,A=mi(r,w,b);if(_o(r,w,b,A,t,g,m)||vd(r,w,b,A,t))return}h|=1<<u}),s[o*e+l]=h}return{w:e,h:i,walk:n,edges:s,step:Xn,agent:t}}function bd(r,t,e){const i=Math.round(t/r.step)-1,n=Math.round(e/r.step)-1;if(i>=0&&n>=0&&i<r.w&&n<r.h&&r.walk[n*r.w+i])return n*r.w+i;let s=-1,a=1/0;for(let o=-2;o<=2;o+=1)for(let l=-2;l<=2;l+=1){const h=i+l,c=n+o;if(h<0||c<0||h>=r.w||c>=r.h||!r.walk[c*r.w+h])continue;const d=Math.hypot((h+1)*r.step-t,(c+1)*r.step-e);d<a&&(a=d,s=c*r.w+h)}return s}function fM(r,t){const e=t%r.w;return{x:(e+1)*r.step,z:((t-e)/r.w+1)*r.step}}function pM(r,t,e=-1,i=1/0){const n=new Int32Array(r.w*r.h).fill(-2);if(t<0)return n;n[t]=-1;const s=new Int32Array(r.w*r.h);let a=0,o=0;for(s[o++]=t;a<o&&a<i;){const l=s[a++];if(l===e)break;const h=r.edges[l],c=l%r.w,d=(l-c)/r.w;for(let u=0;u<8;u+=1){if(!(h&1<<u))continue;const f=(d+Uh[u][1])*r.w+c+Uh[u][0];n[f]===-2&&(n[f]=l,s[o++]=f)}}return n}function yo(r,t,e,i=1/0){const n=bd(r,t.x,t.z),s=bd(r,e.x,e.z);if(n<0||s<0)return null;const a=pM(r,n,s,i);if(a[s]===-2)return null;const o=[];for(let l=s;l!==n&&l!==-1;l=a[l])o.push(fM(r,l));return o.reverse()}const mM=.55,Sd=.42;class gM{constructor(t,{reducedMotion:e=!1}={}){this.camera=t,this.yaw=0,this.pitch=-.3,this.mode="third",this.boomLength=3.4,this.boom=this.boomLength,this.shake=0,this.reducedMotion=e,t.near=.05,t.far=140,t.fov=62,t.updateProjectionMatrix()}look(t,e){this.yaw+=t,this.yaw=Math.atan2(Math.sin(this.yaw),Math.cos(this.yaw)),this.pitch=Math.max(-1.25,Math.min(.55,this.pitch+e))}toggleMode(){return this.mode=this.mode==="third"?"first":"third",this.mode}snap(t){this.yaw=t,this.pitch=-.3,this.boom=.6}addShake(t){this.reducedMotion||(this.shake=Math.max(this.shake,t))}forward(){const t=Math.cos(this.pitch);return{x:-Math.sin(this.yaw)*t,y:Math.sin(this.pitch),z:-Math.cos(this.yaw)*t}}clearBoom(t,e,i,n){let s=.2;for(let a=.2;a<=n;a+=.06){const o=e.x-i.x*a,l=e.y-i.y*a,h=e.z-i.z*a;if(!Ff(t,o,l,h,.16))break;s=a}return Math.max(.2,s-.04)}update(t,e,i){const n=this.camera,s=this.forward();this.shake=Math.max(0,this.shake-t);const a=this.shake*.25,o=a?(Math.random()-.5)*a:0,l=a?(Math.random()-.5)*a:0;if(this.mode==="first"){const d=e.x-Math.sin(this.yaw)*.12,u=e.z-Math.cos(this.yaw)*.12;n.position.set(d+o,e.y+Sd+l,u),n.lookAt(d+s.x,e.y+Sd+s.y,u+s.z);return}const h={x:e.x,y:e.y+mM,z:e.z},c=this.clearBoom(i,h,s,this.boomLength);this.boom=c<this.boom?c:this.boom+(c-this.boom)*(1-Math.exp(-t*3)),n.position.set(h.x-s.x*this.boom+o,h.y-s.y*this.boom+l,h.z-s.z*this.boom),n.lookAt(h.x+s.x*2,h.y+s.y*2,h.z+s.z*2)}getState(){return{mode:this.mode,yaw:this.yaw,pitch:this.pitch,boom:this.boom}}}class wd{constructor(t,{touch:e=!1}={}){this.def=t,this.touch=e,this.reset()}reset(){this.shown=new Set,this.events=new Set,this.queue=[]}textOf(t){const e=this.touch?t.touch:t.keys;return e===void 0?t.text??null:e}onEvent(t){this.events.add(t)}update(t,e){const i=[],n=t.player;for(const s of this.def.hints??[]){if(this.shown.has(s.id))continue;if(s.skipIf&&this.events.has(s.skipIf)){this.shown.add(s.id);continue}const a=s.when;let o=!1;if(a.start!==void 0?o=t.runTime>=a.start:a.moved!==void 0?o=Math.hypot(n.x-e.x,n.z-e.z)>=a.moved:a.near?o=Math.hypot(n.x-(a.near[0]+.5)*Bt,n.z-(a.near[1]+.5)*Bt)<=a.radius:a.beastNear!==void 0?o=t.beasts.some(h=>h.kind==="sleeper"&&!h.awake&&Math.hypot(h.x-n.x,h.z-n.z)<=a.beastNear):a.listenerNear!==void 0?o=t.beasts.some(h=>h.kind==="listener"&&Math.hypot(h.x-n.x,h.z-n.z)<=a.listenerNear):a.event&&(o=this.events.has(a.event)),!o)continue;this.shown.add(s.id);const l=this.textOf(s);l&&i.push({id:s.id,text:l})}return i}}const Os="keys",ks="touch",me=[{id:"hollow",name:"The Hollow",blurb:"Where you woke. Learn to listen.",clear:3.6,ceilVar:.9,par:{time:170,pulses:40},rows:["################################################","####.....#######################....############","###...M...######.......#######.......###########","###.......####....B.....#####....M....##########","####..##..###...........####.....##...##########","#####.##..##.....###.....##.....####..##########","#####.....#....C.###...........#####..##########","######...##.......#....######..####...##########","#######.###..##........#######.......###########","#######.###..####...##########...#.....#########","######...#..######.###########..###..B..########","##e......#.#######.##########..####......#######","#...##.....######...########..#####..##..#######","#.M.##.B...#####.....######..######..##...######","#...........####..S..#####..#######.......######","##..####....####.....####..#######...####..#####","###.####..#######...####..#######..c.####..#####","###......########...###..#######...########.####","####....#########...##..#######..##########.####","#######.########.....#..######..###########.####","#######..######...##.......###.####...#####.####","########..####...####.......#..###..M..###..####","#########..##...######.......#.##........#..####","##########.....#######..##...C...#..##..B...####","###########...#########.##...##.....##.......###","#############.##########....####...####...E..###","#############.M..############.....#####......###","##################..........................####","################################################"],floor:[{rect:[3,5,9,5],h:.3,sharp:!0},{rect:[3,4,9,4],h:.6,sharp:!0},{rect:[3,1,9,3],h:.9,sharp:!0},{rect:[34,22,40,22],ramp:!0,dir:"n",from:0,to:1.1},{rect:[35,20,38,21],h:1.1},{rect:[17,17,19,19],ramp:!0,dir:"s",from:0,to:-.9},{rect:[10,20,28,27],h:-.9},{rect:[29,21,33,27],ramp:!0,dir:"e",from:-.9,to:0}],ceil:[{rect:[14,11,22,17],clear:7},{rect:[11,1,25,9],clear:5.5},{rect:[16,4,19,6],ceil:3},{rect:[7,7,7,9],clear:.8}],hints:[{id:"move",when:{start:.6},[Os]:"WASD to move  ·  mouse to look (click to capture it)",[ks]:"Drag on the left to move  ·  drag on the right to look"},{id:"tap",when:{moved:3},skipIf:"pulse",[Os]:"Tap Space or click: a quiet pulse (4 m)",[ks]:"Tap on the right: a quiet pulse (4 m)"},{id:"hold",when:{near:[15,7],radius:7},[Os]:"Hold Space or the mouse: a loud pulse sees 25 m - and wakes beasts",[ks]:"Hold on the right: a loud pulse sees 25 m - and wakes beasts"},{id:"steps",when:{near:[6,6],radius:4},text:"Low ledges: just walk up them"},{id:"crawl",when:{near:[7,8],radius:4},text:"A crawlway. You fit. The beasts do not."},{id:"beast",when:{beastNear:9},text:"A beast sleeps close by. Quiet pulses only."},{id:"checkpoint",when:{event:"checkpoint"},text:"Crystal lit: you will wake here if caught"},{id:"exit",when:{event:"exitOpened"},text:"The way out is open. Follow its light."},{id:"view",when:{start:40},[Os]:"V switches to first person",[ks]:null}]},{id:"drowned",name:"Drowned Galleries",blurb:"Water carries your call - and every splash.",clear:4.2,ceilVar:1.1,water:{depth:.32},par:{time:200,pulses:40},rows:["############################################","#####.....#######################.....######","####..M....####~~~~~~~#######....~~~~..#####","###...........~~~~~~~~~~~####...~~~~~~~..###","###..####.....~~~~M~~~~~~~~...B.~~~~~~~..###","###..####..C..~~~~~~~~~~~~~~....~~~~M~~..###","##....###.....~~~~~~~~####~~....~~~~~~~..###","##.S..####..########~~####~~~#####~~~~#..###","##....####..########~~####~~~#####~~###..###","###..#####..###.....~~.....~~~~~~~~~~##..###","###..#####..##...B..~~..c..~~~~~~~~~~##..###","###..##.........#####~~#####~~~###~~~##..###","###.....~~~~~...#####~~#####~~~###~~~....###","####...~~~~~~~..###...B...###~~~###~~~##.###","####..~~~M~~~~..###.......###~~~...~~~##.###","#####..~~~~~~...###.......###~~~...~~~##.###","#####...~~~....####...C...####~~~~~~~~##.###","######.......######.......#####~~~~~###e####","#######..##########~~~~~~~######~~~~##..####","#######..##########~~~~~~~#######~~~#..#####","######....########~~~~M~~~~######~~~..B.####","#####......#######~~~~~~~~~~~~~~~~~~.....###","#####..B...######~~~~~~~~~~~~~~~~~~~..E..###","######.....######~~~~~~~~~~~~~~~~~~~.....###","############################################"],floor:[{rect:[1,5,5,8],h:.35},{rect:[3,9,4,10],ramp:!0,dir:"n",from:0,to:.35},{rect:[36,19,41,23],h:.4},{rect:[36,18,40,18],ramp:!0,dir:"s",from:0,to:.4}],ceil:[{rect:[14,2,28,8],clear:7.5},{rect:[17,18,36,23],clear:6},{rect:[6,11,8,12],clear:.9}],hints:[{id:"water",when:{event:"enterWater"},[Os]:"Water carries pulses farther but blurs them. Wading is loud: hold Shift to wade slowly.",[ks]:"Water carries pulses farther but blurs them. Wading is loud: push the stick gently to wade slowly."},{id:"alert",when:{event:"beastAlert"},text:"Something shifts in its sleep. Get out of the water."},{id:"exit",when:{event:"exitOpened"},text:"The way out is open."}]},{id:"crystal",name:"Crystal Veins",blurb:"The rock sings back. Something else listens.",clear:3.8,ceilVar:.9,par:{time:220,pulses:45},rows:["##############################################","##.....#############.M.....##########.....####","#.......*#########....*.....########...M...###","#.......##....*###.........L..######.......###","##..S...##.....###....###.......##....*....###","###...C.##.....###...#####.......*...###..####","####..####..L..###..#######..........###..####","####..####.....###..########...###..####..####","####...*........*...#########..###..####..####","#####.....##############.....*.###..###...####","######...###############..B.......###.....####","#######.################.....###.....c..######","######..########.....###########.....#########","#####..*#######...M...#########...*...########","####...########..*.*..########...........#####","####...#######.......#####.........###...#####","####...######.........####..*.M#######..######","#####L..####...C...e..####.....#######..######","######.......................*.....###..######","######...###########.......########....*######","########...........*####.###########...#######","#####################..M.###########.E.#######","##############################################"],floor:[{rect:[10,2,16,8],h:.8},{rect:[8,8,9,8],ramp:!0,dir:"e",from:0,to:.8},{rect:[14,12,22,17],h:-.6},{rect:[13,18,22,18],ramp:!0,dir:"n",from:0,to:-.6},{rect:[37,1,44,4],h:1.2},{rect:[37,5,42,6],ramp:!0,dir:"n",from:0,to:1.2}],ceil:[{rect:[16,1,33,7],clear:6.5},{rect:[26,13,41,18],clear:5},{rect:[7,9,8,11],clear:.85}],hints:[{id:"crystal",when:{near:[8,2],radius:6},text:"A crystal. Pulse near it and it answers, lighting what you cannot reach. Beasts hear it too."},{id:"listener",when:{listenerNear:11},[Os]:"This one hears footsteps. Hold Shift to sneak.",[ks]:"This one hears footsteps. Push the stick gently to sneak."},{id:"exit",when:{event:"exitOpened"},text:"The way out is open."}]},{id:"throat",name:"The Throat",blurb:"Down for the last light. Then up, fast.",clear:3.4,ceilVar:.7,chase:!0,par:{time:230,pulses:45},rows:["################################","########.......E.......#########","########...............#########","#########......S......##########","############.......#############","#############.....##############","###................c.......M####","###......................B..####","###...##########################","###...##########################","###...##########################","###..........................###","###....M.............C.......###","#########################...####","#########################...####","#########################...####","###....B.....c...............###","###...................M.....####","###...##########################","###...##########################","#e#...##########################","#.#..........C..............M###","#....................B......####","##########################...###","###########............##....###","##########..............#....###","#########.G......M...........###","##########..................####","###########...............######","################################"],floor:[{rect:[0,0,31,5],h:22},{rect:[0,6,31,7],h:22},{rect:[3,6,15,7],ramp:!0,dir:"e",from:17,to:22},{rect:[3,8,5,10],ramp:!0,dir:"n",from:14,to:17},{rect:[0,11,31,12],ramp:!0,dir:"w",from:10,to:14},{rect:[25,13,27,15],ramp:!0,dir:"n",from:7,to:10},{rect:[0,16,31,17],ramp:!0,dir:"e",from:4,to:7},{rect:[3,18,5,20],ramp:!0,dir:"n",from:1.5,to:4},{rect:[0,21,31,22],ramp:!0,dir:"w",from:0,to:1.5},{rect:[0,23,31,29],h:0}],ceil:[{rect:[7,1,23,5],clear:6},{rect:[9,24,30,28],clear:7.5}],hints:[{id:"throat",when:{start:.8},text:"You start just under the surface. Go down for the moths. The last one wakes the Throat: then climb."},{id:"chase",when:{event:"greatWake"},text:"It is awake. Climb. Do not stop."}]}];function xM(r){return me.find(t=>t.id===r)??me[0]}const zf="echoes-below:progress:v1",_M={easy:1.25,normal:1,hard:.9};function $a(){return{v:1,difficulty:"normal",unlocked:1,records:{}}}function Of(){try{return globalThis.localStorage??null}catch{return null}}function yM(){try{const r=Of()?.getItem(zf);if(!r)return $a();const t=JSON.parse(r);return!t||t.v!==1?$a():{...$a(),...t,unlocked:Math.min(me.length,Math.max(1,Number(t.unlocked)||1)),records:t.records&&typeof t.records=="object"?t.records:{}}}catch{return $a()}}function Ed(r){try{return Of()?.setItem(zf,JSON.stringify(r)),!0}catch{return!1}}function kf(r,t){const e=_M[t]??1;return{time:Math.round(r.par.time*e),pulses:Math.round(r.par.pulses*e)}}function Bf(r,t){const e=kf(r,t.difficulty),i={time:t.time<=e.time,pulses:t.pulses<=e.pulses,uncaught:t.deaths===0},n=Object.values(i).filter(Boolean).length;return{stars:n===3?3:n>=2?2:1,checks:i,par:e}}function vM(r,t,e){const{stars:i}=Bf(t,e),n=r.records[t.id]??{},s=n[e.difficulty]??null,a={completed:!0,bestTime:s?.bestTime!=null?Math.min(s.bestTime,e.time):e.time,fewestPulses:s?.fewestPulses!=null?Math.min(s.fewestPulses,e.pulses):e.pulses,stars:Math.max(s?.stars??0,i)},o=me.findIndex(c=>c.id===t.id),l=Math.min(me.length,Math.max(r.unlocked,o+2));return{progress:{...r,unlocked:l,records:{...r.records,[t.id]:{...n,[e.difficulty]:a}}},record:a,stars:i,isBestTime:!s||e.time<s.bestTime,isFewestPulses:!s||e.pulses<s.fewestPulses,unlockedNew:l>r.unlocked?me[l-1]:null}}const Or=Object.freeze({easy:Object.freeze({label:"Easy",hearing:.7,beastSpeed:.82,echoFade:3.4,checkpoints:3,awake:.6,alertDecay:.12}),normal:Object.freeze({label:"Normal",hearing:1,beastSpeed:1,echoFade:2.2,checkpoints:2,awake:1,alertDecay:.07}),hard:Object.freeze({label:"Hard",hearing:1.3,beastSpeed:1.12,echoFade:1.3,checkpoints:1,awake:1.7,alertDecay:.04})}),Td=Object.freeze(["easy","normal","hard"]);function MM(r){return Or[r]??Or.normal}const Ad={C:1,c:2,e:3};function bM(r=me[0]){const t=r.rows,e=t.length,i=Math.max(...t.map(o=>o.length)),n=new Uint8Array(i*e);let s=null;const a={def:r,id:r.id,width:i,height:e,cell:Bt,solid:n,water:null,start:null,checkpoints:[],moths:[],beasts:[],crystals:[],exit:null};for(let o=0;o<e;o+=1)for(let l=0;l<i;l+=1){const h=t[o][l]??"#";n[o*i+l]=h==="#"?1:0,h==="~"&&(s??=new Uint8Array(i*e),s[o*i+l]=1);const c={col:l,row:o,x:(l+.5)*Bt,z:(o+.5)*Bt};if(h==="S")a.start=c;else if(Ad[h])a.checkpoints.push({...c,tier:Ad[h]});else if(h==="M")a.moths.push({...c,id:`moth_${a.moths.length+1}`});else if(h==="B"||h==="L"||h==="G"){const d=h==="B"?"sleeper":h==="L"?"listener":"great";a.beasts.push({...c,kind:d,id:`${d==="great"?"great":"beast"}_${a.beasts.length+1}`})}else h==="*"?a.crystals.push({...c,id:`crystal_${a.crystals.length+1}`}):h==="E"&&(a.exit=c)}return a.water=s,a}const zl=new Map;function SM(r=me[0]){if(zl.has(r))return zl.get(r);const t=bM(r),e=oM(t);t.terrain=e;for(const i of[[t.start],t.checkpoints,t.moths,t.beasts,t.crystals,[t.exit]])for(const n of i)n.y=mi(e,n.x,n.z);for(const i of t.crystals)e.stalagmites.push({x:i.x,z:i.z,y:i.y-.05,radius:.42,height:2.2,crystal:!0,id:i.id});return t.nav={player:Ul(e,Qs.player)},t.beasts.some(i=>i.kind!=="great")&&(t.nav.beast=Ul(e,Qs.beast)),t.beasts.some(i=>i.kind==="great")&&(t.nav.great=Ul(e,Qs.great)),zl.set(r,t),t}const wM=Object.freeze({playerSpeed:3.6,sneakFactor:.42,fastPace:.62,waterSpeed:.8,tapRadius:4,fullRadius:25,waterPulseScale:1.4,tapThreshold:.18,chargeTime:.9,pulseCooldown:.3,pulseSpeed:22,pulseHeight:.4,maxPulses:12,beastSpeed:3.1,beastLungeSpeed:3.9,beastRouse:.7,returnPace:.6,beastSearch:3,beastSenseRadius:2.4,giveUp:8,catchRadius:.85,greatCatchRadius:1.3,greatSpeed:3.05,greatRouse:1.4,greatRepath:.4,greatRespawnBehind:11,mothRadius:1.1,checkpointRadius:1.6,exitRadius:1.8,reachHeight:1.4,crystalRadius:11,crystalLoudness:.35,crystalCooldown:2,footstepRadius:7.5,footstepRate:1.8,awakeHearing:.7,wadeRadius:8,wadeRate:.24,wadeSneakRadius:4,wadeSneakRate:.07,stride:.55,muffled:.5,softPulseRadius:10}),Ht=Object.freeze({TITLE:"title",PLAYING:"playing",PAUSED:"paused",CAUGHT:"caught",WON:"won"}),qt=Object.freeze({SLEEPING:"sleeping",DORMANT:"dormant",ROUSING:"rousing",HUNTING:"hunting",SEARCHING:"searching",RETURNING:"returning",LUNGING:"lunging",CHASING:"chasing"}),Ar=(r,t)=>Math.hypot(r.x-t.x,(r.y??0)-(t.y??0),r.z-t.z);class EM{constructor({level:t=me[0],difficulty:e="normal",tuning:i}={}){this.tuning={...wM,...i??{}},this.listeners=new Map,this.clock=0,this.phase=Ht.TITLE,this.setLevel(t,e)}on(t,e){return this.listeners.has(t)||this.listeners.set(t,new Set),this.listeners.get(t).add(e),()=>this.listeners.get(t)?.delete(e)}emit(t,e={}){for(const i of this.listeners.get(t)??[])i(e);for(const i of this.listeners.get("*")??[])i(t,e)}setLevel(t=this.def,e=this.difficultyId){this.def=typeof t=="string"?me.find(i=>i.id===t)??me[0]:t,this.difficultyId=e in{easy:1,normal:1,hard:1}?e:"normal",this.diff=MM(this.difficultyId),this.level=SM(this.def),this.terrain=this.level.terrain,this.echoFade=this.diff.echoFade,this.phase=Ht.TITLE,this.resetRun()}resetRun(){const{level:t}=this,e=t.start;this.player={x:e.x,y:e.y,z:e.z,facing:0,speed:0,pace:0,sneaking:!1},this.inWater=!1,this.strideLeft=this.tuning.stride,this.checkpointIndex=0;const i=this.diff.checkpoints;this.checkpoints=[{id:"cp_0",x:e.x,y:e.y,z:e.z,active:!0,start:!0},...t.checkpoints.filter(n=>n.tier<=i).map((n,s)=>({id:`cp_${s+1}`,x:n.x,y:n.y,z:n.z,active:!1}))],this.moths=t.moths.map(n=>({...n,collected:!1})),this.crystals=t.crystals.map(n=>({id:n.id,x:n.x,y:n.y,z:n.z,cooldownUntil:-1,lastEcho:-99})),this.beasts=t.beasts.map(n=>this.#t(n)),this.pendingEchoes=[],this.exitOpen=!1,this.chase=!1,this.pulses=[],this.charge=null,this.cooldown=0,this.runTime=0,this.noise=0,this.stats={tapPulses:0,fullPulses:0,deaths:0},this.lastPulse=null,this.result=null}#t(t){const e=t.kind==="great";return{id:t.id,kind:t.kind,homeX:t.x,homeZ:t.z,x:t.x,y:t.y,z:t.z,state:e?qt.DORMANT:qt.SLEEPING,timer:0,target:null,path:[],facing:0,alert:0,alerted:!1,speed:0,stuck:0,repath:0}}#i(t){if(this.phase===t)return;const e=this.phase;this.phase=t,this.emit("phase",{from:e,to:t})}start(){return this.phase!==Ht.TITLE&&this.phase!==Ht.WON?!1:(this.resetRun(),this.#i(Ht.PLAYING),this.emit("start",{level:this.def.id,difficulty:this.difficultyId}),this.softPulse(),!0)}restart(){return this.phase=Ht.TITLE,this.start()}pause(){return this.phase!==Ht.PLAYING?!1:(this.charge=null,this.#i(Ht.PAUSED),!0)}resume(){return this.phase!==Ht.PAUSED?!1:(this.#i(Ht.PLAYING),!0)}togglePause(){return this.phase===Ht.PAUSED?this.resume():this.pause()}respawn(){if(this.phase!==Ht.CAUGHT)return!1;const t=this.checkpoints[this.checkpointIndex];return Object.assign(this.player,{x:t.x,y:t.y,z:t.z,speed:0,pace:0}),this.beasts=this.level.beasts.map(e=>this.#t(e)),this.chase&&this.#l(t),this.pendingEchoes=[],this.charge=null,this.cooldown=0,this.#i(Ht.PLAYING),this.emit("respawn",{checkpoint:t.id,x:t.x,y:t.y,z:t.z}),this.softPulse(),!0}beginCharge(){return this.phase!==Ht.PLAYING||this.charge!==null?!1:(this.charge=0,this.emit("chargeStart",{}),!0)}cancelCharge(){return this.charge===null?!1:(this.charge=null,this.emit("chargeCancel",{}),!0)}releasePulse(){if(this.phase!==Ht.PLAYING||this.charge===null)return null;const t=this.charge;return this.charge=null,this.cooldown>0?(this.emit("pulseBlocked",{}),null):this.emitPulse(this.chargeRadius(t))}chargeRadius(t=this.charge??0){const{tapRadius:e,fullRadius:i,tapThreshold:n,chargeTime:s}=this.tuning,a=Math.min(1,Math.max(0,(t-n)/s));return e+(i-e)*a}emitPulse(t){const{tapRadius:e,fullRadius:i,pulseCooldown:n,waterPulseScale:s,pulseHeight:a}=this.tuning,o=Math.min(i,Math.max(e,t)),l=o<=e+.01?"tap":o>=i-.01?"full":"mid",h=this.inWater,c=this.player,d=this.#s({x:c.x,y:c.y+a,z:c.z,radius:h?o*s:o,kind:l,wet:h,source:"player"});return l==="tap"?this.stats.tapPulses+=1:this.stats.fullPulses+=1,this.cooldown=n,this.lastPulse=d,this.emit("pulse",{...d,loudness:o/i}),this.#n(d,1),d}softPulse(t=this.tuning.softPulseRadius){if(this.phase!==Ht.PLAYING)return null;const e=this.player,i=this.#s({x:e.x,y:e.y+this.tuning.pulseHeight,z:e.z,radius:t,kind:"soft",wet:!1,source:"auto"},{silent:!0});return this.emit("softPulse",{...i}),i}#s(t,{silent:e=!1}={}){const i={...t,time:this.clock};if(this.pulses.push(i),this.pulses.length>this.tuning.maxPulses&&this.pulses.shift(),e)return i;for(const n of this.crystals){if(n.id===t.source||this.pendingEchoes.some(a=>a.crystal===n))continue;const s=Ar(i,{x:n.x,y:n.y+.8,z:n.z});s>i.radius||this.pendingEchoes.push({crystal:n,at:i.time+s/this.tuning.pulseSpeed})}return i}#n(t,e){const i=t.radius*this.diff.hearing*e;for(const n of this.beasts){if(n.state===qt.DORMANT||n.state===qt.CHASING)continue;const s=Ar(n,t);s>i||s>i*this.tuning.muffled&&!this.#a(t,{x:n.x,y:n.y+.7,z:n.z})||this.#o(n,{x:t.x,z:t.z},t.source==="player"?"pulse":"crystal",s)}}#a(t,e){const i=Ar(t,e),n=Math.ceil(i/.5);for(let s=1;s<n;s+=1){const a=s/n;if(!Ff(this.terrain,t.x+(e.x-t.x)*a,t.y+(e.y-t.y)*a,t.z+(e.z-t.z)*a,.02))return!1}return!0}#o(t,e,i,n=0){t.target={x:e.x,z:e.z},t.path=this.#r(t,t.target),t.stuck=0,t.alert=0,t.state===qt.SLEEPING?(t.state=qt.ROUSING,t.timer=this.tuning.beastRouse,this.emit("beastWake",{id:t.id,kind:t.kind,x:t.x,y:t.y,z:t.z,distance:n,cause:i})):t.state!==qt.ROUSING&&t.state!==qt.LUNGING&&(t.state=qt.HUNTING,this.emit("beastHunt",{id:t.id,x:t.x,y:t.y,z:t.z,cause:i}))}#e(t){return t.kind==="great"?this.level.nav.great:this.level.nav.beast}#r(t,e){const i=this.#e(t);return(i&&yo(i,t,e,6e3))??[]}#u(t){return t.kind==="great"?Qs.great:Qs.beast}#l(t){const e=this.beasts.find(o=>o.kind==="great");if(!e)return;const i=this.level.nav.great,n=yo(i,t,{x:e.homeX,z:e.homeZ})??[];let s=0,a=n[n.length-1]??{x:e.homeX,z:e.homeZ};for(let o=1;o<n.length;o+=1)if(s+=Math.hypot(n[o].x-n[o-1].x,n[o].z-n[o-1].z),s>=this.tuning.greatRespawnBehind){a=n[o];break}e.x=a.x,e.z=a.z,e.y=mi(this.terrain,a.x,a.z),e.state=qt.ROUSING,e.timer=this.tuning.greatRouse+.4,e.path=[]}update(t,e={}){this.clock+=t;const i=this.tuning.fullRadius*this.tuning.waterPulseScale/this.tuning.pulseSpeed+this.echoFade+.2;this.pulses=this.pulses.filter(n=>this.clock-n.time<i),this.phase===Ht.PLAYING&&(this.runTime+=t,this.cooldown=Math.max(0,this.cooldown-t),this.charge!==null&&(this.charge+=t),this.#c(t,e),this.#d(),this.#f(t),this.phase===Ht.PLAYING&&this.#v())}#c(t,e){const i=this.tuning,n=Number(e.moveX)||0,s=Number(e.moveY)||0,a=Number(e.yaw)||0;let o=Math.hypot(n,s);const l=-Math.sin(a),h=-Math.cos(a),c=Math.cos(a),d=-Math.sin(a);let u=l*s+c*n,f=h*s+d*n;o>1&&(u/=o,f/=o,o=1);const p=this.player;p.sneaking=!!e.sneak;const x=o*(p.sneaking?i.sneakFactor:1),g=i.playerSpeed*x*(this.charge!==null?.6:1)*(this.inWater?i.waterSpeed:1),m=p.x,M=p.z;o>.01&&(p.facing=Math.atan2(-u,-f),Md(this.terrain,p,u/o*g*t,f/o*g*t,Qs.player));const E=Math.hypot(p.x-m,p.z-M);p.speed=E/t,p.pace=E>1e-4?x:0;const v=this.inWater;this.inWater=Lf(this.level,p.x,p.z),this.inWater&&!v&&this.emit("enterWater",{x:p.x,z:p.z});const w=p.pace>i.fastPace;this.noise=E>1e-4?this.inWater?w?1:.4:w?.55:.1:0,E>1e-4&&(this.strideLeft-=E,this.strideLeft<=0&&(this.strideLeft+=i.stride*(w?1:1.3),this.emit("step",{x:p.x,y:p.y,z:p.z,water:this.inWater,pace:p.pace})),w&&this.#h("footsteps",i.footstepRadius,i.footstepRate,t,b=>b.kind==="listener"),this.inWater&&this.#h("wading",w?i.wadeRadius:i.wadeSneakRadius,w?i.wadeRate:i.wadeSneakRate,t,()=>!0));for(const b of this.beasts)b.heardAt===this.clock||b.state!==qt.SLEEPING||(b.alert=Math.max(0,b.alert-this.diff.alertDecay*t),b.alert<.3&&(b.alerted=!1))}#h(t,e,i,n,s){const a=this.player,o=e*this.diff.hearing;for(const l of this.beasts){if(!s(l)||l.kind==="great")continue;const h=Ar(l,a);h>o||(l.state===qt.SLEEPING?(l.heardAt=this.clock,l.alert+=n*i*(1-h/o)*2,l.alert>=.5&&!l.alerted&&(l.alerted=!0,this.emit("beastAlert",{id:l.id,kind:l.kind,x:l.x,y:l.y,z:l.z,cause:t})),l.alert>=1&&this.#o(l,a,t,h)):h<o*this.tuning.awakeHearing&&(l.state===qt.SEARCHING||l.state===qt.RETURNING||l.state===qt.HUNTING&&this.clock-(l.lastHeard??-9)>.6)&&(l.lastHeard=this.clock,this.#o(l,a,t,h)))}}#d(){if(!this.pendingEchoes.length)return;const t=this.pendingEchoes.filter(e=>e.at<=this.clock);if(t.length){this.pendingEchoes=this.pendingEchoes.filter(e=>e.at>this.clock);for(const{crystal:e}of t){if(e.cooldownUntil>this.clock)continue;e.cooldownUntil=this.clock+this.tuning.crystalCooldown,e.lastEcho=this.clock;const i=this.#s({x:e.x,y:e.y+.8,z:e.z,radius:this.tuning.crystalRadius,kind:"crystal",wet:!1,source:e.id});this.emit("crystalEcho",{id:e.id,x:e.x,y:e.y+.8,z:e.z,radius:i.radius}),this.#n(i,this.tuning.crystalLoudness)}}}#f(t){const e=this.tuning,i=this.player,n=e.beastSenseRadius*this.diff.hearing,s=this.diff.beastSpeed;for(const a of this.beasts){if(a.speed=0,a.state===qt.SLEEPING||a.state===qt.DORMANT)continue;if(a.state===qt.ROUSING){a.timer-=t,a.timer<=0&&(a.kind==="great"?(a.state=qt.CHASING,a.repath=0,this.emit("greatChase",{id:a.id})):a.state=qt.HUNTING);continue}if(a.kind==="great")this.#_(a,t,e.greatSpeed*s);else if(Ar(a,i)<n&&Math.abs(a.y-i.y)<1.6&&this.clock>=(a.giveUpUntil??-1)?(a.state!==qt.LUNGING&&this.emit("beastLunge",{id:a.id,x:a.x,y:a.y,z:a.z}),a.state=qt.LUNGING):a.state===qt.LUNGING&&(a.state=qt.SEARCHING,a.timer=e.beastSearch*this.diff.awake),a.state===qt.LUNGING){const h=e.beastLungeSpeed*s*t;this.#m(a,i.x,i.z,h),a.stall=a.speed<h*.25?(a.stall??0)+t:0,a.stall>1.5&&(a.stall=0,a.giveUpUntil=this.clock+e.giveUp,a.state=qt.SEARCHING,a.timer=e.beastSearch*this.diff.awake,this.emit("beastGiveUp",{id:a.id,x:a.x,y:a.y,z:a.z}))}else a.state===qt.HUNTING?this.#p(a,t,e.beastSpeed*s,()=>{a.state=qt.SEARCHING,a.timer=e.beastSearch*this.diff.awake}):a.state===qt.SEARCHING?(a.timer-=t,a.facing+=t*1.5,a.timer<=0&&(Math.hypot(a.homeX-a.x,a.homeZ-a.z)>1.5?(a.state=qt.RETURNING,a.target={x:a.homeX,z:a.homeZ},a.path=this.#r(a,a.target),a.stuck=0):this.#x(a))):a.state===qt.RETURNING&&this.#p(a,t,e.beastSpeed*e.returnPace*s,()=>this.#x(a));const o=a.kind==="great"?e.greatCatchRadius:e.catchRadius;if(Math.hypot(i.x-a.x,i.z-a.z)<o&&Math.abs(i.y-a.y)<1.5){this.#y(a);return}}}#x(t){t.state=qt.SLEEPING,t.target=null,t.alert=0,this.emit("beastSettle",{id:t.id,x:t.x,y:t.y,z:t.z})}#_(t,e,i){t.repath-=e,(t.repath<=0||!t.path.length)&&(t.repath=this.tuning.greatRepath,t.target={x:this.player.x,z:this.player.z},t.path=this.#r(t,t.target)),Math.hypot(this.player.x-t.x,this.player.z-t.z)<2.5?this.#m(t,this.player.x,this.player.z,i*e):this.#p(t,e,i,()=>{})}#p(t,e,i,n){const s=t.path[0];if(!s){n();return}const a=t.path.length===1,o=a&&t.target?t.target.x:s.x,l=a&&t.target?t.target.z:s.z,h=Math.hypot(o-t.x,l-t.z),c=this.#m(t,o,l,i*e);if(c<.3||a&&c<.8){t.path.shift(),t.stuck=0;return}t.stuck=h-c<i*e*.2?t.stuck+e:0,t.stuck>1.2&&(t.stuck=0,t.path=[],n())}#m(t,e,i,n){const s=e-t.x,a=i-t.z,o=Math.hypot(s,a);if(o>1e-4){const l=Math.min(1,n/o),h=t.x,c=t.z;Md(this.terrain,t,s*l,a*l,this.#u(t)),t.speed=Math.hypot(t.x-h,t.z-c),t.facing=Math.atan2(-s,-a)}return Math.hypot(e-t.x,i-t.z)}#y(t){this.stats.deaths+=1,this.charge=null,this.#i(Ht.CAUGHT),this.emit("caught",{by:t.id,kind:t.kind,x:this.player.x,y:this.player.y,z:this.player.z})}#g(t,e){const i=this.player;return Math.hypot(t.x-i.x,t.z-i.z)<e&&Math.abs((t.y??i.y)-i.y)<this.tuning.reachHeight}#v(){const t=this.tuning,e=this.moths.length;for(const i of this.moths){if(i.collected||!this.#g(i,t.mothRadius))continue;i.collected=!0;const n=this.mothsCollected();if(this.emit("mothCollected",{id:i.id,count:n,required:e,x:i.x,y:i.y,z:i.z}),n>=e&&!this.exitOpen){this.exitOpen=!0;const s=this.level.exit;this.emit("exitOpened",{x:s.x,y:s.y,z:s.z});const a=this.beasts.find(o=>o.kind==="great");this.def.chase&&a&&(this.chase=!0,a.state=qt.ROUSING,a.timer=t.greatRouse,this.emit("greatWake",{id:a.id,x:a.x,y:a.y,z:a.z}))}}this.checkpoints.forEach((i,n)=>{this.#g(i,t.checkpointRadius)&&(i.active?n!==this.checkpointIndex&&(this.checkpointIndex=n):(i.active=!0,this.checkpointIndex=n,this.emit("checkpoint",{id:i.id,x:i.x,y:i.y,z:i.z})))}),this.exitOpen&&this.#g(this.level.exit,t.exitRadius)&&(this.result={level:this.def.id,difficulty:this.difficultyId,time:this.runTime,pulses:this.stats.tapPulses+this.stats.fullPulses,tapPulses:this.stats.tapPulses,fullPulses:this.stats.fullPulses,deaths:this.stats.deaths},this.#i(Ht.WON),this.emit("won",this.result))}mothsCollected(){return this.moths.reduce((t,e)=>t+(e.collected?1:0),0)}getState(){const t=this.player;return{phase:this.phase,level:this.def.id,difficulty:this.difficultyId,clock:this.clock,runTime:this.runTime,player:{x:t.x,y:t.y,z:t.z,facing:t.facing,speed:t.speed,sneaking:t.sneaking,inWater:this.inWater},noise:this.noise,charging:this.charge!==null,chargeRadius:this.charge!==null?this.chargeRadius():0,cooldown:this.cooldown,mothsCollected:this.mothsCollected(),mothsRequired:this.moths.length,moths:this.moths.map(e=>({id:e.id,x:e.x,y:e.y,z:e.z,collected:e.collected})),beasts:this.beasts.map(e=>({id:e.id,kind:e.kind,x:e.x,y:e.y,z:e.z,state:e.state,alert:e.alert,awake:e.state!==qt.SLEEPING&&e.state!==qt.DORMANT})),crystals:this.crystals.map(e=>({id:e.id,x:e.x,y:e.y,z:e.z,lastEcho:e.lastEcho})),chase:this.chase,checkpoint:this.checkpoints[this.checkpointIndex].id,checkpoints:this.checkpoints.map(e=>({id:e.id,x:e.x,y:e.y,z:e.z,active:e.active})),exit:{x:this.level.exit.x,y:this.level.exit.y,z:this.level.exit.z,open:this.exitOpen},stats:{...this.stats,pulses:this.stats.tapPulses+this.stats.fullPulses},result:this.result}}}function vo(r,t=!1){const e=r[0].index!==null,i=new Set(Object.keys(r[0].attributes)),n=new Set(Object.keys(r[0].morphAttributes)),s={},a={},o=r[0].morphTargetsRelative,l=new Ze;let h=0;for(let c=0;c<r.length;++c){const d=r[c];let u=0;if(e!==(d.index!==null))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."),null;for(const f in d.attributes){if(!i.has(f))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+'. All geometries must have compatible attributes; make sure "'+f+'" attribute exists among all geometries, or in none of them.'),null;s[f]===void 0&&(s[f]=[]),s[f].push(d.attributes[f]),u++}if(u!==i.size)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". Make sure all geometries have the same number of attributes."),null;if(o!==d.morphTargetsRelative)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". .morphTargetsRelative must be consistent throughout all geometries."),null;for(const f in d.morphAttributes){if(!n.has(f))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+".  .morphAttributes must be consistent throughout all geometries."),null;a[f]===void 0&&(a[f]=[]),a[f].push(d.morphAttributes[f])}if(t){let f;if(e)f=d.index.count;else if(d.attributes.position!==void 0)f=d.attributes.position.count;else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+c+". The geometry must have either an index or a position attribute"),null;l.addGroup(h,f,c),h+=f}}if(e){let c=0;const d=[];for(let u=0;u<r.length;++u){const f=r[u].index;for(let p=0;p<f.count;++p)d.push(f.getX(p)+c);c+=r[u].attributes.position.count}l.setIndex(d)}for(const c in s){const d=Rd(s[c]);if(!d)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+c+" attribute."),null;l.setAttribute(c,d)}for(const c in a){const d=a[c][0].length;if(d!==0){l.morphAttributes=l.morphAttributes||{},l.morphAttributes[c]=[];for(let u=0;u<d;++u){const f=[];for(let x=0;x<a[c].length;++x)f.push(a[c][x][u]);const p=Rd(f);if(!p)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+c+" morphAttribute."),null;l.morphAttributes[c].push(p)}}}return l}function Rd(r){let t,e,i,n=-1,s=0;for(let h=0;h<r.length;++h){const c=r[h];if(t===void 0&&(t=c.array.constructor),t!==c.array.constructor)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."),null;if(e===void 0&&(e=c.itemSize),e!==c.itemSize)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."),null;if(i===void 0&&(i=c.normalized),i!==c.normalized)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."),null;if(n===-1&&(n=c.gpuType),n!==c.gpuType)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."),null;s+=c.count*e}const a=new t(s),o=new Ri(a,e,i);let l=0;for(let h=0;h<r.length;++h){const c=r[h];if(c.isInterleavedBufferAttribute){const d=l/e;for(let u=0,f=c.count;u<f;u++)for(let p=0;p<e;p++){const x=c.getComponent(u,p);o.setComponent(u+d,p,x)}}else a.set(c.array,l);l+=c.count*e}return n!==void 0&&(o.gpuType=n),o}const kr=12,ro=8,TM=`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`,AM=`
  #define MAX_PULSES ${kr}
  #define MAX_LIGHTS ${ro}
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
  varying vec3 vWorld;

  float band(float v, float width) {
    float fw = max(fwidth(v), 1e-4);
    float d = abs(fract(v - 0.5) - 0.5);
    return 1.0 - smoothstep(fw * 0.6, fw * width, d);
  }

  void main() {
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 V = normalize(cameraPosition - vWorld);
    if (dot(N, V) < 0.0) N = -N;
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.0);

    float glow = 0.0;
    float front = 0.0;
    float blur = 0.0;
    for (int i = 0; i < MAX_PULSES; i++) {
      if (i >= uCount) break;
      vec4 p = uPulse[i];
      float t0 = uPulseB[i].x;
      float wet = uPulseB[i].y;
      float age = uTime - t0;
      float wave = age * uSpeed;
      float d = distance(vWorld, p.xyz);
      if (wet > 0.5) {
        // Water: the wavefront ripples and smears.
        d += (sin(vWorld.x * 2.3 + uTime * 3.1) + sin(vWorld.z * 2.9 - uTime * 2.6) + sin((vWorld.x + vWorld.y) * 4.1 + uTime * 4.0) * 0.5) * 0.22;
      }
      if (d > p.w || d > wave) continue;
      float since = age - d / uSpeed;
      float g = clamp(1.0 - since / uFade, 0.0, 1.0);
      g *= g;
      float rim = smoothstep(p.w, p.w * 0.72, d);
      if (wet > 0.5) { g *= 0.7 + 0.3 * sin(d * 5.0 - uTime * 6.0); blur = max(blur, g * rim); }
      glow = max(glow, g * rim);
      float fw = wet > 0.5 ? 1.0 : 0.38;
      float x = (wave - d) / fw;
      if (wave < p.w + 1.5) front = max(front, exp(-x * x) * rim);
    }
    // Whisker sense: a faint touch-radius right around the creature.
    float near = distance(vWorld, uPlayer);
    glow = max(glow, 0.24 * smoothstep(2.3, 0.3, near));

    vec3 light = vec3(0.0);
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uLightCount) break;
      float d = distance(vWorld, uLight[i].xyz);
      float k = clamp(1.0 - d / uLight[i].w, 0.0, 1.0);
      light += uLightColor[i] * k * k * (0.35 + 0.65 * ndv);
    }

    vec3 col;
    if (uKind > 1.5) {
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
      float contour = band(vWorld.y * 1.3 + (vWorld.x + vWorld.z) * 0.06, 2.6);
      float strata = band((vWorld.x * 0.55 + vWorld.z * 0.45) + vWorld.y * 0.2, 2.2) * wall;
      float lines = max(contour, strata * 0.7);
      vec3 tint = N.y < -0.35 ? mix(uColor, vec3(0.55, 0.5, 1.0), 0.4) : uColor;
      col = tint * glow * (0.035 + 0.5 * fres + 0.55 * lines)
          + uFront * front * (0.12 + 0.5 * fres + 0.55 * lines)
          + light * (0.22 + 0.35 * lines);
      col = mix(col, col * vec3(0.8, 1.0, 1.15) + uColor * blur * 0.06, blur);
    }
    gl_FragColor = vec4(col * uStrength, 1.0);
  }
`;class RM{constructor({speed:t,fade:e}){this.uniforms={uTime:{value:0},uPulse:{value:Array.from({length:kr},()=>new Wi)},uPulseB:{value:Array.from({length:kr},()=>new se)},uCount:{value:0},uSpeed:{value:t},uFade:{value:e},uLight:{value:Array.from({length:ro},()=>new Wi)},uLightColor:{value:Array.from({length:ro},()=>new oi)},uLightCount:{value:0},uPlayer:{value:new $}},this.materials=[]}material(t,{color:e=3139327,front:i=16056319,strength:n=1}={}){const s={rock:0,creature:1,water:2}[t],a=t==="water",o=new qr({vertexShader:TM,fragmentShader:AM,uniforms:{...this.uniforms,uColor:{value:new oi(e)},uFront:{value:new oi(i)},uKind:{value:s},uStrength:{value:n}},side:Eo,transparent:a,depthWrite:!a,blending:a?Qn:po});return o.extensions={derivatives:!0},o.toneMapped=!1,this.materials.push(o),o}setFade(t){this.uniforms.uFade.value=t}sync(t,e,i,n=[]){this.uniforms.uTime.value=t;const s=Math.min(kr,e.length);for(let o=0;o<s;o+=1){const l=e[e.length-s+o];this.uniforms.uPulse.value[o].set(l.x,l.y,l.z,l.radius),this.uniforms.uPulseB.value[o].set(l.time,l.wet?1:0)}this.uniforms.uCount.value=s,this.uniforms.uPlayer.value.set(i.x,i.y+.3,i.z);const a=Math.min(ro,n.length);for(let o=0;o<a;o+=1){const l=n[o];this.uniforms.uLight.value[o].set(l.x,l.y,l.z,l.radius),this.uniforms.uLightColor.value[o].set(l.color).multiplyScalar(l.intensity??1)}this.uniforms.uLightCount.value=a}}function Br(r,{base:t=.25,rim:e=1.2,opacity:i=1,additive:n=!1}={}){const s=new qr({uniforms:{uColor:{value:new oi(r)},uBase:{value:t},uRim:{value:e},uOpacity:{value:i}},vertexShader:`
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
      }`,transparent:i<1||n,depthWrite:!n,blending:n?Qn:po,side:n?Eo:fo});return s.toneMapped=!1,s}const Cd=650,Ya=18,Pd=28,Ol=360,CM=`
  #define MAX_PULSES ${kr}
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
`,PM=`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c) * 4.0;
    if (r > 1.0) discard;
    float k = (1.0 - r);
    gl_FragColor = vec4(vColor * vAlpha * k * k, 1.0);
  }
`;function kl(r){const t=new Ze,e=i=>{const n=new Ri(new Float32Array(r*i),i);return n.setUsage(_v),n};return t.setAttribute("position",e(3)),t.setAttribute("aColor",e(3)),t.setAttribute("aSize",e(1)),t.setAttribute("aAlpha",e(1)),t.setAttribute("aEcho",e(1)),t.boundingSphere=new To(new $,1e5),t}class DM{constructor(t,e,i,{seed:n=1}={}){this.rules=i,this.T=i.terrain,this.root=new Ye,this.root.name="fx.particles",t.add(this.root);let s=n>>>0;this.rand=()=>(s=s*1664525+1013904223>>>0,s/4294967296),this.uniforms={...e.uniforms,uCenter:{value:new $},uWrap:{value:0},uScale:{value:300}};const a=l=>{const h=new qr({vertexShader:CM,fragmentShader:PM,uniforms:{...this.uniforms,uWrap:{value:l}},transparent:!0,depthWrite:!1,blending:Qn});return h.toneMapped=!1,h};this.dust=new Nl(kl(Cd),a(Ya)),this.dust.frustumCulled=!1,this.dust.name="fx.dust";const o=this.dust.geometry.attributes;for(let l=0;l<Cd;l+=1){o.position.setXYZ(l,this.rand()*Ya,this.rand()*Ya,this.rand()*Ya);const h=this.rand()<.2;o.aColor.setXYZ(l,h?.85:.6,h?.9:.95,1),o.aSize.setX(l,.035+this.rand()*.04),o.aAlpha.setX(l,0),o.aEcho.setX(l,.35+this.rand()*.5)}this.root.add(this.dust),this.drips=Array.from({length:Pd},()=>({live:!1})),this.dripMesh=new Nl(kl(Pd*3),a(0)),this.dripMesh.frustumCulled=!1,this.dripMesh.name="fx.drips",this.root.add(this.dripMesh),this.sparks=Array.from({length:Ol},()=>({life:0})),this.sparkNext=0,this.sparkMesh=new Nl(kl(Ol),a(0)),this.sparkMesh.frustumCulled=!1,this.sparkMesh.name="fx.sparks",this.root.add(this.sparkMesh),this.dripTimer=0,this.trailTimer=0}setScale(t){this.uniforms.uScale.value=t}dispose(){this.root.removeFromParent();for(const t of[this.dust,this.dripMesh,this.sparkMesh])t.geometry.dispose(),t.material.dispose()}spark(t,e,i,n,s,a,{color:o=[1,.69,.23],life:l=1.2,size:h=.07,drag:c=1.6,gravity:d=-.6,echo:u=0}={}){const f=this.sparkNext;this.sparkNext=(f+1)%Ol,Object.assign(this.sparks[f],{x:t,y:e,z:i,vx:n,vy:s,vz:a,color:o,life:l,max:l,size:h,drag:c,gravity:d,echo:u})}burst(t,e,i,{color:n=[1,.69,.23],count:s=40,speed:a=3.2,rise:o=.6,life:l=1.1,size:h=.09}={}){for(let c=0;c<s;c+=1){const d=this.rand()*Math.PI*2,u=this.rand()*2-1,f=Math.sqrt(1-u*u),p=a*(.45+this.rand()*.55);this.spark(t,e,i,Math.cos(d)*f*p,u*p*.6+o,Math.sin(d)*f*p,{color:n,life:l*(.6+this.rand()*.5),size:h,drag:2.4,gravity:-1.2})}}#t(t){const e=this.drips.find(i=>!i.live);if(e)for(let i=0;i<6;i+=1){const n=t.x+(this.rand()-.5)*22,s=t.z+(this.rand()-.5)*22,a=mi(this.T,n,s),o=sr(this.T,n,s);if(!(!(o-a>1.2)||a>900)){Object.assign(e,{live:!0,x:n,z:s,y:o-.1,vy:0,floor:a,splash:0});return}}}update(t,e){const i=this.rules,n=i.player;if(this.uniforms.uCenter.value.set(n.x,n.y+1.2,n.z),i.phase==="playing"&&(this.dripTimer-=t,this.dripTimer<=0&&(this.dripTimer=.12+this.rand()*.25,this.#t(n)),this.trailTimer-=t,this.trailTimer<=0)){this.trailTimer=.05;for(const o of e){if(!o.group.visible)continue;const l=o.group.position;Math.hypot(l.x-n.x,l.z-n.z)>40||this.spark(l.x+(this.rand()-.5)*.15,l.y+(this.rand()-.5)*.1,l.z+(this.rand()-.5)*.15,(this.rand()-.5)*.3,-.12-this.rand()*.15,(this.rand()-.5)*.3,{life:1.1+this.rand()*.6,size:.045+this.rand()*.03,drag:.8,gravity:-.05})}}const s=this.dripMesh.geometry.attributes;this.drips.forEach((o,l)=>{o.live&&(o.splash?(o.splash-=t,o.splash<=0&&(o.live=!1)):(o.vy-=9.8*t,o.y+=o.vy*t,o.y<=o.floor+.02&&(o.splash=.35,o.y=o.floor+.03)));for(let h=0;h<3;h+=1){const c=l*3+h;if(!o.live){s.aAlpha.setX(c,0),s.aEcho.setX(c,0);continue}if(!o.splash)s.position.setXYZ(c,o.x,o.y+h*Math.min(.12,-o.vy*.012),o.z),s.aSize.setX(c,.05-h*.012),s.aAlpha.setX(c,.1-h*.025);else{const d=1-o.splash/.35,u=h*2.1;s.position.setXYZ(c,o.x+Math.cos(u)*d*.25,o.y+Math.sin(d*Math.PI)*.12,o.z+Math.sin(u)*d*.25),s.aSize.setX(c,.035),s.aAlpha.setX(c,.16*(1-d))}s.aColor.setXYZ(c,.55,.9,1),s.aEcho.setX(c,.9)}});for(const o of["position","aColor","aSize","aAlpha","aEcho"])s[o].needsUpdate=!0;const a=this.sparkMesh.geometry.attributes;this.sparks.forEach((o,l)=>{if(o.life>0){o.life-=t;const c=Math.exp(-o.drag*t);o.vx*=c,o.vy=o.vy*c+o.gravity*t,o.vz*=c,o.x+=o.vx*t,o.y+=o.vy*t,o.z+=o.vz*t}if(o.life<=0){a.aAlpha.setX(l,0),a.aEcho.setX(l,0);return}const h=o.life/o.max;a.position.setXYZ(l,o.x,o.y,o.z),a.aColor.setXYZ(l,o.color[0],o.color[1],o.color[2]),a.aSize.setX(l,o.size*(.5+.5*h)),a.aAlpha.setX(l,Math.min(1,h*1.6)*.9),a.aEcho.setX(l,o.echo)});for(const o of["position","aColor","aSize","aAlpha","aEcho"])a[o].needsUpdate=!0}}const he={sonar:3139327,amber:16756794,eye:16721446,player:10474239,beast:16761538,great:16751226,listener:14727423,checkpoint:8257496,exit:13629695,crystal:11832575,water:6279423};let Hs=null;function IM(){if(Hs)return Hs;const r=document.createElement("canvas");r.width=r.height=64;const t=r.getContext("2d"),e=t.createRadialGradient(32,32,0,32,32,32);return e.addColorStop(0,"rgba(255,255,255,1)"),e.addColorStop(.25,"rgba(255,255,255,0.45)"),e.addColorStop(1,"rgba(255,255,255,0)"),t.fillStyle=e,t.fillRect(0,0,64,64),Hs=new Wv(r),Hs.colorSpace=ui,Hs}function Rn(r,t,e=1,i=!0){const n=new Vv(new Rf({map:IM(),color:r,transparent:!0,opacity:e,blending:Qn,depthWrite:!1,depthTest:i}));return n.scale.setScalar(t),n}function js(r,t={}){const e=new Df({color:r,...t});return e.toneMapped=!1,e}function LM(r){const{nx:t,nz:e,F:i,C:n,K:s,res:a}=r,o=new Float32Array(t*e*2*3);for(let d=0;d<e;d+=1)for(let u=0;u<t;u+=1){const f=d*t+u;o.set([u*a,i[f],d*a],f*3),o.set([u*a,n[f],d*a],(t*e+f)*3)}const l=[],h=t*e;for(let d=0;d<e-1;d+=1)for(let u=0;u<t-1;u+=1){const f=d*t+u,p=f+1,x=f+t+1,g=f+t;s[f]>.985&&s[p]>.985&&s[x]>.985&&s[g]>.985||(l.push(f,x,p,f,g,x),l.push(h+f,h+p,h+x,h+f,h+x,h+g))}const c=new Ze;return c.setAttribute("position",new Ri(o,3)),c.setIndex(l),c.computeBoundingSphere(),c}function zi(r,t,e=0,i=0,n=0){const s=new Le(r,t);return s.position.set(e,i,n),s}function NM(){const r=new Ye;r.name="chr.player";const t=Br(he.player,{base:.32,rim:1.3}),e=Br(16758480,{base:.4,rim:.9}),i=new Ye,n=zi(new di(.2,12,9),t,0,.27,.02);n.scale.set(1,.85,1.3);const s=new Ye;s.position.set(0,.4,-.2);const a=zi(new di(.14,12,9),t),o=zi(new Vi(.06,.14,8),t,0,-.03,-.14);o.rotation.x=-Math.PI/2;const l=zi(new di(.025,6,5),e,0,-.03,-.21);s.add(a,o,l);const h=[-1,1].map(f=>{const p=new Ye;p.position.set(f*.07,.08,.02);const x=zi(new di(.16,10,8),t,f*.1,.15,0);x.scale.set(.42,1,.16);const g=zi(new di(.12,10,8),e,f*.1,.15,-.02);return g.scale.set(.38,.9,.08),p.add(x,g),p.rotation.z=-f*.5,s.add(p),p}),c=[[-1,-.12],[1,-.12],[-1,.16],[1,.16]].map(([f,p])=>{const x=new Ye;x.position.set(f*.11,.2,p);const g=zi(new Zr(.028,.022,.2,6),t,0,-.1,0),m=zi(new di(.035,6,5),t,0,-.2,-.015);return x.add(g,m),i.add(x),x}),d=zi(new Vi(.04,.3,6),t,0,.26,.38);d.rotation.x=Math.PI/2+.5,i.add(n,s,d);const u=Rn(he.player,1.4,.35);return u.position.y=.3,r.add(i,u),{group:r,body:i,head:s,ears:h,legs:c,tail:d,halo:u,torso:n}}function FM(r,t){const e=new Ye,i=r==="listener",n=new di(.6,9,6);n.scale(i?.7:.85,i?.5:.55,1.35);const s=[n];for(let x=0;x<6;x+=1){const g=new Vi(.07,.34+Math.sin(x*.9)*.1,4);g.rotateX(.6),g.translate(0,.3-Math.abs(x-2)*.03,-.55+x*.25),s.push(g)}const a=new Le(vo(s.map(x=>x.toNonIndexed())),t);a.position.y=i?.72:.6;const o=new Ye;o.position.set(0,i?.82:.68,-.95);const l=new di(.32,8,6);l.scale(1,.8,1.2);const h=new Vi(.22,.55,6);h.rotateX(-Math.PI/2),h.translate(0,-.12,-.38);const c=[l.toNonIndexed(),h.toNonIndexed()];if(i)for(const x of[-1,1]){const g=new Vi(.12,.62,5);g.rotateZ(-x*.45),g.translate(x*.22,.38,.05),c.push(g.toNonIndexed())}o.add(new Le(vo(c),t));const d=new Ye;for(const x of[-1,1])d.add(zi(new di(.06,8,6),js(he.eye),x*.14,.06,-.28));const u=Rn(he.eye,1.3,.8);u.position.set(0,.06,-.3),d.add(u),d.visible=!1,o.add(d);const f=i?.75:.6,p=[[-1,-.5],[1,-.5],[-1,.6],[1,.6]].map(([x,g])=>{const m=new Ye;m.position.set(x*.42,f,g);const M=new Vi(.1,f,5);return M.rotateZ(Math.PI),M.translate(x*.08,-f/2,0),m.add(new Le(M,t)),m.rotation.z=x*.25,m});return e.add(a,o,...p),r==="great"&&e.scale.setScalar(1.75),{group:e,torso:a,head:o,eyes:d,legs:p}}function UM(){const r=new Ye,t=new Le(new lc(.06,.18,4,8),js(16765562));t.rotation.x=Math.PI/2;const e=new Ze;e.setAttribute("position",new Ri(new Float32Array([0,0,-.1,.34,0,-.2,.26,0,.16]),3));const i=js(he.amber,{side:Eo,transparent:!0,opacity:.85}),n=new Le(e,i),s=new Le(e,i);s.scale.x=-1;const a=Rn(he.amber,2.2,.7);return r.add(t,n,s,a),{group:r,left:n,right:s,halo:a}}class Dd{constructor(t,e,{particles:i=!0}={}){this.host=t,this.rules=e,this.level=e.level,this.terrain=e.terrain,this.sonar=new RM({speed:e.tuning.pulseSpeed,fade:e.echoFade}),this.time=0,this.root=new Ye,this.root.name=`level:${this.level.id}`,this.bursts=[],this.playerY=e.player.y,this.walkPhase=0,this.#t(),this.#i(),this.#s(),this.#n(),this.#a(),this.#o(),this.#e(),this.particles=i?new DM(this.root,this.sonar,e,{seed:this.level.width*31+this.level.height}):null,this.exitFlash=0,t.add(this.root,"environment")}dispose(){this.particles?.dispose(),this.host.remove(this.root),this.root.traverse(t=>{t.geometry?.dispose?.(),t.material&&t.material.map!==Hs&&t.material.dispose?.()})}#t(){const t=this.terrain,e=new Le(LM(t),this.sonar.material("rock"));e.name="env.cave",this.root.add(e);const i=[];for(const s of t.stalagmites){if(s.crystal)continue;const a=new Vi(s.radius,s.height,7,2);a.translate(s.x,s.y+s.height/2,s.z),i.push(a.toNonIndexed())}for(const s of t.stalactites){const a=new Vi(s.radius,s.length,6,2);a.rotateX(Math.PI),a.translate(s.x,s.y-s.length/2,s.z),i.push(a.toNonIndexed())}if(i.length){const s=new Le(vo(i),this.sonar.material("rock",{strength:1.1}));s.name="env.stalagmites",this.root.add(s)}const n=this.level;if(n.water){const s=[];n.def.water?.depth;for(let o=0;o<n.height;o+=1)for(let l=0;l<n.width;l+=1){if(!n.water[o*n.width+l])continue;const h=new Ro(Bt+.6,Bt+.6);h.rotateX(-Math.PI/2),h.translate((l+.5)*Bt,-.06+(n.def.water?.y??0),(o+.5)*Bt),s.push(h)}const a=new Le(vo(s),this.sonar.material("water",{color:he.water,strength:.9}));a.name="env.water",a.renderOrder=2,this.root.add(a)}}#i(){this.creature=NM(),this.root.add(this.creature.group);const t=new Le(new di(1,32,16),Br(he.sonar,{base:0,rim:.5,additive:!0,opacity:.6}));t.visible=!1,this.chargeShell=t,this.root.add(t)}#s(){this.moths=this.rules.moths.map((t,e)=>{const i=UM();return i.group.name=`prop.moth:${t.id}`,i.group.position.set(t.x,t.y+1,t.z),this.root.add(i.group),{...i,id:t.id,phase:e*1.7,baseX:t.x,baseY:t.y,baseZ:t.z}})}#n(){const t={sleeper:this.sonar.material("creature",{color:he.beast,front:16777215}),listener:this.sonar.material("creature",{color:he.listener,front:16777215}),great:this.sonar.material("creature",{color:he.great,front:16777215,strength:1.2})};this.beasts=this.rules.beasts.map((e,i)=>{const n=FM(e.kind,t[e.kind]);return n.group.name=`chr.beast:${e.id}`,this.root.add(n.group),{...n,id:e.id,kind:e.kind,phase:i*2.3,stride:0,rise:0}})}#a(){this.crystals=this.rules.crystals.map((t,e)=>{const i=new Ye;i.name=`prop.crystal:${t.id}`;const n=Br(he.crystal,{base:.18,rim:1});for(let a=0;a<5;a+=1){const o=new go(.22+(a===0?.12:0),0);o.scale(.7,3.2-a*.35,.7);const l=new Le(o,n),h=a*1.3+e;l.position.set(a?Math.cos(h)*.25:0,.7-a*.08,a?Math.sin(h)*.25:0),l.rotation.set(a?Math.cos(h)*.35:0,h,a?Math.sin(h)*.35:0),i.add(l)}const s=Rn(he.crystal,3,.15);return s.position.y=1,i.add(s),i.position.set(t.x,t.y-.05,t.z),this.root.add(i),{id:t.id,group:i,mat:n,halo:s}})}#o(){this.checkpoints=this.rules.checkpoints.map(t=>{const e=new Ye;e.name=`prop.checkpoint:${t.id}`;const i=new go(.32,0);i.scale(1,1.8,1);const n=new Le(i,Br(he.checkpoint,{base:.15,rim:.9}));n.position.y=.75;const s=Rn(he.checkpoint,2.4,.15);return s.position.y=.75,e.add(n,s),e.position.set(t.x,t.y,t.z),e.visible=!t.start,this.root.add(e),{id:t.id,group:e,crystal:n,halo:s}})}#e(){const t=this.level.exit,e=new Ye;e.name="prop.exit";const i=new Le(new xo(1.1,.07,6,40),js(he.exit,{transparent:!0,opacity:.15}));i.rotation.x=Math.PI/2,i.position.y=.08;const n=[0,1,2].map(()=>{const l=new Le(new xo(.9,.04,4,40),js(he.exit,{transparent:!0,opacity:0,blending:Qn,depthWrite:!1}));return l.rotation.x=Math.PI/2,e.add(l),l}),s=new Le(new Zr(.9,1.1,6,24,1,!0),js(he.exit,{transparent:!0,opacity:0,blending:Qn,depthWrite:!1,side:Eo}));s.position.y=3;const a=Rn(he.exit,5,0);a.position.y=1.2;const o=Rn(he.exit,2.2,0,!1);o.position.y=1.6,o.renderOrder=10,e.add(i,s,a,o),e.position.set(t.x,t.y,t.z),this.root.add(e),this.exit={group:e,ring:i,rings:n,halo:a,beam:s,beacon:o}}burst(t,e,i,n,s=4,{sparks:a=0}={}){const o=Rn(n,.5,1);if(o.position.set(t,e+1,i),this.root.add(o),this.bursts.push({sprite:o,age:0,size:s}),a&&this.particles){const l=new oi(n);this.particles.burst(t,e+1,i,{color:[l.r,l.g,l.b],count:a})}}exitOpened(){const t=this.level.exit;this.exitFlash=1,this.burst(t.x,t.y,t.z,he.exit,9),this.particles?.burst(t.x,t.y+.4,t.z,{color:[.8,.97,1],count:70,speed:2.4,rise:3.2,life:1.8,size:.1})}setPointScale(t){this.particles?.setScale(t)}setFirstPerson(t){this.creature.body.visible=!t,this.creature.halo.visible=!t}#r(){const t=this.rules,e=t.player,i=[{x:e.x,y:e.y+.4,z:e.z,radius:2.6,color:he.player,intensity:.55}];t.exitOpen&&i.push({x:t.level.exit.x,y:t.level.exit.y+1.2,z:t.level.exit.z,radius:12,color:he.exit,intensity:1.5+this.exitFlash*1.5});const n=t.moths.filter(a=>!a.collected).map(a=>({m:a,d:Math.hypot(a.x-e.x,a.z-e.z)})).sort((a,o)=>a.d-o.d).slice(0,4);for(const{m:a}of n)i.push({x:a.x,y:a.y+1,z:a.z,radius:4.5,color:he.amber,intensity:.8});const s=t.checkpoints[t.checkpointIndex];s.start||i.push({x:s.x,y:s.y+.8,z:s.z,radius:3.5,color:he.checkpoint,intensity:.6});for(const a of t.beasts)a.kind==="great"&&t.chase&&i.length<8&&i.push({x:a.x,y:a.y+1.6,z:a.z,radius:3.5,color:he.eye,intensity:.5});return i}render(t){this.time+=t;const e=this.rules,i=e.player;this.sonar.setFade(e.echoFade),this.sonar.sync(e.clock,e.pulses,i,this.#r());const n=this.creature;this.playerY=i.y>this.playerY?i.y:Math.max(i.y,this.playerY-t*6),n.group.position.set(i.x,this.playerY,i.z);let s=i.facing-n.group.rotation.y;s=Math.atan2(Math.sin(s),Math.cos(s)),n.group.rotation.y+=s*(1-Math.exp(-t*12));const a=Math.min(1,i.speed/e.tuning.playerSpeed);this.walkPhase+=t*(4+a*14)*(a>.02?1:0),n.legs.forEach((u,f)=>{u.rotation.x=Math.sin(this.walkPhase+(f%2===(f<2?0:1)?0:Math.PI))*.7*a}),n.torso.position.y=.27+Math.abs(Math.sin(this.walkPhase))*.03*a+Math.sin(this.time*2.2)*.006,n.head.position.y=.4+Math.sin(this.walkPhase*2)*.012*a;const o=e.charge!==null,l=e.lastPulse?e.clock-e.lastPulse.time:9;if(n.ears.forEach((u,f)=>{const p=f?1:-1,x=l<.6?.25*(1-l/.6):0,g=-p*(o?.15:.5+x)+Math.sin(this.time*1.7+f)*.04;u.rotation.z+=(g-u.rotation.z)*(1-Math.exp(-t*10)),u.rotation.x=o?-.3:0}),n.tail.rotation.y=Math.sin(this.time*3+this.walkPhase)*.3,n.halo.material.opacity=.3+Math.sin(this.time*2)*.06,this.chargeShell.visible=o,o){const u=e.chargeRadius()*(e.inWater?e.tuning.waterPulseScale:1);this.chargeShell.scale.setScalar(u),this.chargeShell.position.set(i.x,i.y+e.tuning.pulseHeight,i.z),this.chargeShell.material.uniforms.uOpacity.value=.25+.3*(u/e.tuning.fullRadius)}for(const u of this.moths){const f=e.moths.find(g=>g.id===u.id);if(u.group.visible=!f.collected,f.collected)continue;const p=this.time+u.phase,x=Math.sin(p*14)*.9;u.left.rotation.z=x,u.right.rotation.z=-x,u.group.position.set(u.baseX+Math.sin(p*.7)*.35,u.baseY+1+Math.sin(p*1.3)*.18,u.baseZ+Math.cos(p*.9)*.35),u.group.rotation.y=p*.6,u.halo.material.opacity=.45+Math.sin(p*3.1)*.2}for(const u of this.beasts){const f=e.beasts.find(v=>v.id===u.id);u.group.position.set(f.x,f.y,f.z);let p=f.facing-u.group.rotation.y;p=Math.atan2(Math.sin(p),Math.cos(p)),u.group.rotation.y+=p*(1-Math.exp(-t*8));const x=f.state==="sleeping"||f.state==="dormant",m=f.speed>1e-4?Math.min(1.2,f.speed/(t*3.1)):0;u.stride+=t*(2+m*9);const M=Math.sin(this.time*(x?1.3:3.2)+u.phase);u.torso.scale.set(1+M*.025,1+M*.05,1),u.rise+=((x?0:1)-u.rise)*(1-Math.exp(-t*4)),u.torso.position.y=(u.kind==="listener"?.72:.6)-(1-u.rise)*.22+Math.abs(Math.sin(u.stride))*.05*m,u.head.rotation.x=x?.35+M*.04:-.1+Math.sin(u.stride*2)*.06*m,u.head.position.y=(u.kind==="listener"?.82:.68)-(1-u.rise)*.3,u.legs.forEach((v,w)=>{v.rotation.x=Math.sin(u.stride+(w===0||w===3?0:Math.PI))*.55*m-(1-u.rise)*(w<2?-.8:.8)}),f.state==="searching"?u.head.rotation.y=Math.sin(this.time*2.5)*.6:u.head.rotation.y*=.9;const E=f.state==="rousing"?Math.sin(this.time*30)>0?1:0:1;u.eyes.visible=!x&&E>.5,u.eyes.children[2].material.opacity=f.state==="lunging"||f.state==="chasing"?1:.7}for(const u of this.crystals){const f=e.crystals.find(x=>x.id===u.id),p=Math.max(0,1-(e.clock-f.lastEcho)/1.2);u.mat.uniforms.uBase.value=.15+p*.9,u.halo.material.opacity=.12+p*.8+Math.sin(this.time*1.5+u.group.position.x)*.04}e.checkpoints.forEach((u,f)=>{const p=this.checkpoints[f],x=f===e.checkpointIndex;p.crystal.rotation.y=this.time*(u.active?.8:.2),p.crystal.material.uniforms.uBase.value=u.active?.5:.12,p.halo.material.opacity=x?.5+Math.sin(this.time*2)*.1:u.active?.2:.06});const h=e.exitOpen,c=this.exit;c.ring.material.opacity=h?.9:.12,c.ring.rotation.z=this.time*.5,c.rings.forEach((u,f)=>{const p=(this.time*.45+f/3)%1;u.position.y=.1+p*3.2,u.scale.setScalar(1-p*.45),u.material.opacity=h?Math.sin(p*Math.PI)*.9:0}),this.exitFlash=Math.max(0,this.exitFlash-t*.6);const d=.5+.5*Math.sin(this.time*2.2);c.beam.material.opacity=h?.26+d*.08+this.exitFlash*.4:0,c.halo.material.opacity=h?1:0,c.halo.scale.setScalar(h?7+d*1.2+this.exitFlash*6:5),c.beacon.material.opacity=h?.75+d*.15:0,c.beacon.scale.setScalar(h?2.6+d*.5:2.2),this.particles?.update(t,this.moths),this.bursts=this.bursts.filter(u=>{u.age+=t;const f=u.age/.9;return u.sprite.scale.setScalar(.5+u.size*f),u.sprite.material.opacity=Math.max(0,1-f),f>=1?(this.root.remove(u.sprite),u.sprite.material.dispose(),!1):!0})}}const zM=`
.eb-touch { position:absolute; inset:0; z-index:3; touch-action:none; user-select:none; -webkit-user-select:none; }
.eb-touch[hidden] { display:none; }
.eb-touch-on .a3game-hud-slot[data-a3game-anchor="top-right"] { top:70px; }
.eb-touch-on .a3game-hud-slot[data-a3game-anchor="bottom-right"] { bottom:72px; }
.eb-stick-base, .eb-stick-knob { position:absolute; border-radius:50%; pointer-events:none; transform:translate(-50%,-50%); }
.eb-stick-base { width:120px; height:120px; border:2px solid rgba(47,230,255,.45); background:rgba(47,230,255,.06); }
.eb-stick-knob { width:54px; height:54px; background:rgba(47,230,255,.35); border:2px solid rgba(220,250,255,.8); }
.eb-touch-hint { position:absolute; bottom:22px; font:12px "Avenir Next","Segoe UI",system-ui,sans-serif; letter-spacing:.12em;
  color:rgba(217,246,255,.45); text-transform:uppercase; pointer-events:none; }
.eb-touch-hint.left { left:22px; } .eb-touch-hint.right { right:22px; text-align:right; }
.eb-touch-pause { position:absolute; top:12px; right:12px; width:48px; height:48px; border-radius:50%; pointer-events:auto;
  border:1px solid rgba(47,230,255,.6); background:rgba(0,0,0,.35); color:#fff; font-size:18px; letter-spacing:0; }
.eb-touch-view { position:absolute; top:12px; right:70px; width:48px; height:48px; border-radius:50%; pointer-events:auto;
  border:1px solid rgba(47,230,255,.4); background:rgba(0,0,0,.35); color:#fff; font:12px system-ui,sans-serif; }
.eb-pulse-ring { position:absolute; width:20px; height:20px; border-radius:50%; border:2px solid rgba(47,230,255,.8);
  transform:translate(-50%,-50%); pointer-events:none; }
`,Rr=55,OM=10,kM=.11;function BM(){try{return(globalThis.matchMedia?.("(pointer: coarse)").matches??!1)||(navigator.maxTouchPoints??0)>0}catch{return!1}}class VM{constructor({root:t,onLook:e,onPulseDown:i,onPulseUp:n,onPulseCancel:s,onPause:a,onView:o}){const l=document.createElement("style");l.textContent=zM,document.head.appendChild(l),this.el=document.createElement("div"),this.el.className="eb-touch",this.el.id="eb-touch",this.el.hidden=!0,this.el.innerHTML=`
      <div class="eb-touch-hint left">drag to move</div>
      <div class="eb-touch-hint right">drag look · tap pulse<br>hold loud</div>
      <button class="eb-touch-view" id="eb-touch-view" aria-label="Switch view">VIEW</button>
      <button class="eb-touch-pause" id="eb-touch-pause" aria-label="Pause">II</button>`,t.appendChild(this.el),this.base=document.createElement("div"),this.base.className="eb-stick-base",this.knob=document.createElement("div"),this.knob.className="eb-stick-knob",this.base.hidden=!0,this.knob.hidden=!0,this.el.append(this.base,this.knob),this.cb={onLook:e,onPulseDown:i,onPulseUp:n,onPulseCancel:s},this.move={x:0,y:0},this.stick=null,this.right=null,this.enabled=!1,this.visible=!1,this.el.querySelector("#eb-touch-pause").addEventListener("click",h=>{h.stopPropagation(),a()}),this.el.querySelector("#eb-touch-view").addEventListener("click",h=>{h.stopPropagation(),o()});for(const h of this.el.querySelectorAll("button"))h.addEventListener("pointerdown",c=>c.stopPropagation());this.el.addEventListener("pointerdown",h=>this.#i(h)),this.el.addEventListener("pointermove",h=>this.#s(h)),this.el.addEventListener("pointerup",h=>this.#n(h)),this.el.addEventListener("pointercancel",h=>this.#n(h,!0))}setEnabled(t){this.enabled=t,this.el.parentElement?.classList.toggle("eb-touch-on",t),this.#t()}setVisible(t){this.visible=t,t||this.reset(),this.#t()}#t(){this.el.hidden=!(this.enabled&&this.visible)}reset(){this.move={x:0,y:0},this.stick=null,this.right?.mode==="charge"&&this.cb.onPulseCancel(),this.right=null,this.base.hidden=!0,this.knob.hidden=!0}#i(t){t.preventDefault(),this.el.setPointerCapture?.(t.pointerId);const e=this.el.getBoundingClientRect(),i=t.clientX-e.left,n=t.clientY-e.top;i<e.width/2&&!this.stick?(this.stick={id:t.pointerId,ox:i,oy:n},this.base.hidden=!1,this.knob.hidden=!1,this.base.style.left=`${i}px`,this.base.style.top=`${n}px`,this.knob.style.left=`${i}px`,this.knob.style.top=`${n}px`,this.move={x:0,y:0}):i>=e.width/2&&!this.right&&(this.right={id:t.pointerId,sx:i,sy:n,lx:i,ly:n,t:0,mode:"pending"})}#s(t){const e=this.el.getBoundingClientRect(),i=t.clientX-e.left,n=t.clientY-e.top;if(this.stick?.id===t.pointerId){let s=i-this.stick.ox,a=n-this.stick.oy;const o=Math.hypot(s,a);o>Rr&&(s*=Rr/o,a*=Rr/o),this.knob.style.left=`${this.stick.ox+s}px`,this.knob.style.top=`${this.stick.oy+a}px`,this.move={x:s/Rr,y:-a/Rr}}else if(this.right?.id===t.pointerId){const s=this.right;s.mode!=="look"&&Math.hypot(i-s.sx,n-s.sy)>OM&&(s.mode==="charge"&&this.cb.onPulseCancel(),s.mode="look"),s.mode==="look"&&this.cb.onLook(i-s.lx,n-s.ly),s.lx=i,s.ly=n}}#n(t,e=!1){if(this.stick?.id===t.pointerId)this.stick=null,this.move={x:0,y:0},this.base.hidden=!0,this.knob.hidden=!0;else if(this.right?.id===t.pointerId){const i=this.right;if(this.right=null,e){i.mode==="charge"&&this.cb.onPulseCancel();return}i.mode==="charge"?this.cb.onPulseUp():i.mode==="pending"&&(this.cb.onPulseDown(),this.cb.onPulseUp(),this.#a(i.sx,i.sy))}}#a(t,e){const i=document.createElement("div");i.className="eb-pulse-ring",i.style.left=`${t}px`,i.style.top=`${e}px`,this.el.appendChild(i),i.animate?.([{width:"20px",height:"20px",opacity:1},{width:"140px",height:"140px",opacity:0}],{duration:450}),setTimeout(()=>i.remove(),460)}update(t){const e=this.right;e&&e.mode==="pending"&&(e.t+=t,e.t>=kM&&(e.mode="charge",this.cb.onPulseDown()))}}const GM=`
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
.eb-btn:hover, .eb-btn:focus-visible { background:rgba(47,230,255,.14); outline:none; }
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
.eb-levels { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin:0 0 20px; }
.eb-card { pointer-events:auto; text-align:left; background:rgba(47,230,255,.04); border:1px solid rgba(47,230,255,.35); color:#fff;
  border-radius:14px; padding:14px; font:inherit; cursor:pointer; min-height:120px; }
.eb-card:hover, .eb-card:focus-visible { background:rgba(47,230,255,.12); outline:none; }
.eb-card[disabled] { cursor:default; opacity:.4; }
.eb-card h3 { margin:0 0 4px; font-size:16px; font-weight:500; letter-spacing:.06em; }
.eb-card p { margin:0 0 8px; font-size:12px; color:rgba(217,246,255,.6); line-height:1.4; }
.eb-card .rec { font-size:12px; color:rgba(217,246,255,.8); font-variant-numeric:tabular-nums; }
.eb-card .st { color:var(--amber); letter-spacing:.15em; }
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
.a3game-hud-widget.eb-noise { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:rgba(217,246,255,.6); }
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
`;function Bs(r){const t=Math.floor(r/60),e=Math.floor(r%60);return`${t}:${String(e).padStart(2,"0")}`}const HM=r=>`${"<i>★</i>".repeat(r)}${"★".repeat(3-r)}`;class WM{constructor({root:t,hud:e,commands:i,touch:n=!1}){this.hud=e,this.commands=i,this.touch=n;const s=document.createElement("style");s.textContent=GM,document.head.appendChild(s),this.vignette=document.createElement("div"),this.vignette.className="eb-vignette",t.appendChild(this.vignette),this.overlay=document.createElement("div"),this.overlay.className="eb-overlay",this.overlay.id="eb-overlay",t.appendChild(this.overlay),this.overlay.addEventListener("click",a=>{const o=a.target.closest("[data-cmd]");!o||o.disabled||this.commands[o.dataset.cmd]?.(o.dataset.arg)}),e.addText("moths",{anchor:"top-left",value:"",className:"eb-hud eb-moths"}),e.addText("level",{anchor:"top-left",value:"",className:"eb-hud eb-level"}),e.addText("timer",{anchor:"top-right",value:"",className:"eb-hud"}),e.addText("toast",{anchor:"top-center",value:"",className:"eb-hud eb-toast"}),e.addText("tip",{anchor:"bottom-center",value:"",className:"eb-hud eb-tip"}),e.addText("noise",{anchor:"bottom-right",value:"",className:"eb-hud eb-noise"}),e.addText("help",{anchor:"bottom-left",value:`Tap Space / click: quiet pulse   Hold: loud pulse
WASD move  ·  mouse / arrows look  ·  Shift sneak
V view  ·  Esc pause`,className:"eb-hud eb-help"}),e.setVisible("tip",!1),e.setVisible("help",!n),this.toastTime=0,this.tipTime=0,this.tipQueue=[],this.screen=null}setTouch(t){this.touch=t,this.hud.setVisible("help",!t)}#t(t,e,i){this.screen=i,this.overlay.className=`eb-overlay ${t}`,this.overlay.innerHTML=e,this.overlay.hidden=!1,this.overlay.scrollTop=0,this.overlay.querySelector("[data-focus]")?.focus({preventScroll:!0}),this.hud.root.style.visibility="hidden"}hideScreens(){this.overlay.hidden=!0,this.overlay.innerHTML="",this.screen=null,this.hud.root.style.visibility=""}#i(t){return`<div class="eb-seg" role="group" aria-label="Difficulty">${Td.map(e=>`
      <button data-cmd="setDifficulty" data-arg="${e}" id="eb-diff-${e}" aria-pressed="${e===t}">${Or[e].label}</button>`).join("")}</div>`}showTitle(t){const e=this.touch?`<b>left side</b><span>drag to move (gently to sneak)</span>
         <b>right side</b><span>drag to look</span>
         <b>tap right</b><span>quiet pulse, 4 m</span>
         <b>hold right</b><span>loud pulse, up to 25 m</span>`:`<b>WASD</b><span>move (Shift to sneak)</span>
         <b>mouse / arrows</b><span>look  ·  V first person</span>
         <b>tap Space / click</b><span>quiet pulse, 4 m</span>
         <b>hold Space / mouse</b><span>loud pulse, up to 25 m</span>`;this.#t("eb-black",`
      <div class="eb-rings"><i></i><i></i><i></i></div>
      <div class="eb-screen" data-screen="title">
        <h1 class="eb-title">ECHOES BELOW</h1>
        <p class="eb-sub">You are small, and blind, and the cave is black. Call into the dark and the rock answers.
        Gather the glow-moths of each cave to wake the way up. Something else sleeps down here. Keep it quiet.</p>
        <div class="eb-keys">${e}</div>
        ${this.#i(t.difficulty)}<br>
        <button class="eb-btn" data-cmd="openSelect" id="eb-start" data-focus>Descend</button>
        <div class="eb-hint">Headphones help: you can hear where things are.</div>
      </div>`,"title")}showIntro(t,e){this.#t("eb-black eb-intro",`
      <div class="eb-rings"><i></i><i></i><i></i></div>
      <div class="eb-screen" data-screen="intro">
        ${t.map((o,l)=>`<p class="eb-intro-line" style="animation-delay:${(.4+l*2.4).toFixed(1)}s">${o}</p>`).join("")}
        <div class="eb-hint">${this.touch?"Tap to skip":"Press any key to skip"}</div>
      </div>`,"intro");let n=!1;const s=()=>{n||(n=!0,clearTimeout(a),window.removeEventListener("keydown",s,!0),window.removeEventListener("pointerdown",s,!0),e())},a=setTimeout(s,(.4+t.length*2.4+2.6)*1e3);setTimeout(()=>{n||(window.addEventListener("keydown",s,!0),window.addEventListener("pointerdown",s,!0))},250)}setDifficulty(t){for(const e of Td)this.overlay.querySelector(`#eb-diff-${e}`)?.setAttribute("aria-pressed",String(e===t))}showSelect(t){const e=t.difficulty,i=me.map((n,s)=>{const a=s<t.unlocked,o=t.records[n.id]?.[e],l=kf(n,e),h=o?`<div class="rec"><span class="st">${"★".repeat(o.stars)}${"☆".repeat(3-o.stars)}</span><br>best ${Bs(o.bestTime)} · ${o.fewestPulses} pulses</div>`:`<div class="rec">${a?`par ${Bs(l.time)} · ${l.pulses} pulses`:"locked"}</div>`;return`<button class="eb-card" data-cmd="play" data-arg="${n.id}" id="eb-level-${n.id}" ${a?"":"disabled"} ${a&&!o?"data-focus":""}>
        <h3>${s+1}. ${n.name}</h3><p>${a?n.blurb:"Surface from the cave before it to open this one."}</p>${h}</button>`}).join("");this.#t("eb-black",`
      <div class="eb-screen" data-screen="select">
        <h1 class="eb-title" style="font-size:clamp(24px,5vw,40px)">THE CAVES</h1>
        ${this.#i(e)}
        <div class="eb-levels">${i}</div>
        <button class="eb-btn" data-cmd="openTitle">Back</button>
      </div>`,"select"),this.overlay.querySelector("[data-focus]")||this.overlay.querySelector(".eb-card:not([disabled])")?.focus({preventScroll:!0})}showPause(t){this.#t("eb-dim",`
      <div class="eb-screen" data-screen="paused">
        <h1 class="eb-title" style="font-size:44px">PAUSED</h1>
        <p class="eb-sub">The dark waits.</p>
        <button class="eb-btn" data-cmd="resume" data-focus>Resume</button>
        <button class="eb-btn" data-cmd="restart">Restart cave</button>
        <button class="eb-btn" data-cmd="openSelect">Caves</button>
        <button class="eb-btn" data-cmd="toggleMute" id="eb-mute">Sound: ${t?"off":"on"}</button>
        <div class="eb-hint">${this.touch?"Tap Resume to carry on":"Esc to resume"}</div>
      </div>`,"paused")}setMuteLabel(t){const e=this.overlay.querySelector("#eb-mute");e&&(e.textContent=`Sound: ${t?"off":"on"}`)}showCaught(t){this.#t("eb-caught",`
      <div class="eb-screen" data-screen="caught">
        <h1 class="eb-title">CAUGHT</h1>
        <p class="eb-sub">${t?"It was faster in the dark. Climb harder.":"Something in the dark heard you."}</p>
        <button class="eb-btn" data-cmd="respawn" id="eb-respawn" data-focus>Wake at the last crystal</button>
        <div class="eb-hint">${this.touch?"Your moths stay with you.":"Enter or Space. Your moths stay with you."}</div>
      </div>`,"caught")}showResults({def:t,result:e,stars:i,checks:n,par:s,record:a,isBestTime:o,isFewestPulses:l,unlockedNew:h,last:c}){const d=me[me.findIndex(f=>f.id===t.id)+1],u=c?'<button class="eb-btn" data-cmd="openEnding" id="eb-next" data-focus>Surface</button>':`<button class="eb-btn" data-cmd="play" data-arg="${d.id}" id="eb-next" data-focus>Next: ${d.name}</button>`;this.#t("eb-black",`
      <div class="eb-screen" data-screen="results">
        <h1 class="eb-title" style="font-size:clamp(24px,5vw,42px)">${t.name.toUpperCase()}</h1>
        <div class="eb-stars" id="eb-stars" data-stars="${i}">${HM(i)}</div>
        <ul class="eb-checks">
          <li class="${n.time?"ok":""}">under ${Bs(s.time)}</li>
          <li class="${n.pulses?"ok":""}">${s.pulses} pulses or fewer</li>
          <li class="${n.uncaught?"ok":""}">never caught</li>
        </ul>
        <div class="eb-stats">
          <span>Time</span><span id="eb-res-time">${Bs(e.time)}${o?'<span class="eb-new">best</span>':""}</span>
          <span>Pulses</span><span id="eb-res-pulses">${e.pulses} (${e.tapPulses} quiet, ${e.fullPulses} loud)${l?'<span class="eb-new">fewest</span>':""}</span>
          <span>Caught</span><span>${e.deaths} ${e.deaths===1?"time":"times"}</span>
          <span>Best</span><span>${Bs(a.bestTime)} · ${a.fewestPulses} pulses</span>
        </div>
        ${h&&!c?`<p class="eb-sub">${h.name} is open.</p>`:""}
        ${u}
        <button class="eb-btn" data-cmd="restart">Again</button>
        <button class="eb-btn" data-cmd="openSelect">Caves</button>
      </div>`,"results")}showEnding(t){this.#t("eb-surface",`
      <div class="eb-screen" data-screen="ending">
        <h1 class="eb-title" style="font-size:clamp(28px,6vw,54px)">SURFACED</h1>
        <p class="eb-sub">Wind. Cold air that goes on forever. Above you the dark is full of tiny lights,
        and none of them are moths. You call once, loud, and nothing answers. Nothing needs to.</p>
        <div class="eb-stats">
          <span>Caves</span><span>${t.levels} of ${me.length}</span>
          <span>Stars</span><span id="eb-total-stars">${t.stars} of ${me.length*3}</span>
          <span>Difficulty</span><span>${Or[t.difficulty].label}</span>
        </div>
        <button class="eb-btn" data-cmd="openTitle" id="eb-end-title" data-focus>Back to the dark</button>
      </div>`,"ending")}toast(t,e=2.2){this.hud.setValue("toast",t),this.hud.setVisible("toast",!0),this.toastTime=e}tip(t){this.tipQueue.push(t),this.tipTime<=0&&this.#s()}#s(){const t=this.tipQueue.shift();if(!t){this.hud.setVisible("tip",!1),this.tipTime=0;return}this.hud.setValue("tip",t),this.hud.setVisible("tip",!0),this.tipTime=Math.max(3.5,t.length*.07)}clearTips(){this.tipQueue=[],this.tipTime=0,this.hud.setVisible("tip",!1),this.hud.setVisible("toast",!1)}flashDanger(t){this.vignette.style.opacity=String(t)}update(t,e,i){this.hud.setValue("moths",`Glow-moths  ${e.mothsCollected} / ${e.mothsRequired}${e.exit.open?"   -  the way out is open":""}`),this.hud.setValue("level",`${i}  ·  ${Or[e.difficulty].label}`),this.hud.setValue("timer",`${Bs(e.runTime)}    pulses ${e.stats.pulses}`);const n=e.noise;this.hud.setValue("noise",n<=0?"":n>=.9?"●●● splashing":n>=.5?"●● loud steps":n>=.3?"●○ wading":"●○○ quiet"),this.toastTime>0&&(this.toastTime-=t,this.toastTime<=0&&this.hud.setVisible("toast",!1)),this.tipTime>0&&(this.tipTime-=t,this.tipTime<=0&&this.#s())}}const XM=2.4,Id=.0024,Vf="echoes-below:intro:v1",qM=["You hatched in the dark, too far down for any light to reach.","You have no eyes. You have a voice, and the rock answers it.","The glow-moths know the way up. Gather them, and the way out wakes.","Something else lives down here. It listens too."];function $M(){let r="high";try{r=globalThis.window?.patch?.quality??"high"}catch{}return r==="low"||r==="medium"?r:"high"}const YM=()=>{try{return globalThis.localStorage?.getItem(Vf)==="1"}catch{return!1}},ZM=()=>{try{globalThis.localStorage?.setItem(Vf,"1")}catch{}};async function KM({viewport:r="#a3game-viewport",hudContainer:t="#a3game-hud"}={}){const e=$M(),i=e==="high",n=new iv({container:r,hudContainer:t,antialias:!0,shadows:!1,clearColor:0,pixelRatioCap:{high:2,medium:1.25,low:1}[e],toneMapping:"NoToneMapping",fov:62,near:.05,far:140,fixedTimeStep:1/60});await n.init();const s=i?tM(n.renderer,n.scene):null,a=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches??!1;let o=yM();const l=new EM({level:me[0],difficulty:o.difficulty});let h=new Dd(n,l,{particles:i});const c=new gM(n.camera,{reducedMotion:a}),d=new uv,u=new av({container:n.hudContainer});let f=BM(),p=new wd(l.def,{touch:f});const x=n.container.parentElement??document.body;let g=0,m=null;const M=()=>{const k=l.level.start,xt=l.level.moths.map(Ct=>({m:Ct,p:yo(l.level.nav.player,k,Ct)})).filter(Ct=>Ct.p).sort((Ct,Y)=>Ct.p.length-Y.p.length)[0],wt=xt?.p[Math.min(4,xt.p.length-1)];return wt?Math.atan2(-(wt.x-k.x),-(wt.z-k.z)):0},E=k=>{const xt=xM(k);(l.def!==xt||l.difficultyId!==o.difficulty||!h)&&(l.setLevel(xt,o.difficulty),h.dispose(),h=new Dd(n,l,{particles:i}),h.setFirstPerson(c.mode==="first")),p=new wd(l.def,{touch:f})},v=()=>{d.unlock(),d.stopAll(),l.restart(),c.snap(M()),h.playerY=l.player.y,p.reset(),A.clearTips(),A.hideScreens(),_.setVisible(!0),A.toast(l.def.name,2.5)},w=k=>{_.setVisible(!1),d.stopAll(),document.pointerLockElement&&document.exitPointerLock?.(),k()},b={openTitle:()=>w(()=>{l.phase=Ht.TITLE,A.showTitle(o)}),openSelect:()=>w(()=>{d.unlock(),l.phase=Ht.TITLE,A.showSelect(o)}),setDifficulty:k=>{o={...o,difficulty:k},Ed(o),A.screen==="select"?A.showSelect(o):A.setDifficulty(k)},play:k=>{if(k===me[0].id&&!YM()){ZM(),d.unlock(),A.showIntro(qM,()=>{A.screen==="intro"&&(E(k),v())});return}E(k),v()},start:()=>v(),restart:()=>v(),resume:()=>{l.resume()&&(A.hideScreens(),_.setVisible(!0))},pause:()=>{l.pause()&&(g=performance.now(),d.stopCharge(),_.setVisible(!1),A.showPause(d.muted))},togglePause:()=>l.phase===Ht.PAUSED?b.resume():b.pause(),respawn:()=>{l.respawn()&&(h.playerY=l.player.y,A.hideScreens(),_.setVisible(!0))},toggleMute:()=>{d.setMuted(!d.muted),A.setMuteLabel(d.muted)},toggleView:()=>{const k=c.toggleMode();h.setFirstPerson(k==="first")},openEnding:()=>w(()=>{const k=me.filter(wt=>o.records[wt.id]?.[o.difficulty]?.completed).length,xt=me.reduce((wt,Ct)=>wt+(o.records[Ct.id]?.[o.difficulty]?.stars??0),0);d.surfaced(),A.showEnding({levels:k,stars:xt,difficulty:o.difficulty})})},A=new WM({root:x,hud:u,commands:b,touch:f}),_=new VM({root:x,onLook:(k,xt)=>c.look(-k*.0065,-xt*.005),onPulseDown:()=>{d.unlock(),l.beginCharge()&&d.startCharge()},onPulseUp:()=>{l.releasePulse(),d.stopCharge()},onPulseCancel:()=>{l.cancelCharge(),d.stopCharge()},onPause:()=>b.pause(),onView:()=>b.toggleView()});_.setEnabled(f);const T=k=>{k.pointerType!=="touch"||f||(f=!0,_.setEnabled(!0),A.setTouch(!0),p.touch=!0,l.phase===Ht.PLAYING&&_.setVisible(!0))};window.addEventListener("pointerdown",T,!0);const C=new cv({target:n.container,controllerId:"player",keyBindings:{Space:"none",ArrowLeft:"none",ArrowRight:"none"},actionBindings:{Space:"pulse",Mouse0:"pulse",Escape:"pause",KeyP:"pause",Enter:"confirm",KeyM:"mute",KeyV:"view",ArrowLeft:"turnLeft",ArrowRight:"turnRight"},lookMode:so.POINTER_LOCK,pointerSensitivity:0});C.enable();const P=n.renderer?.domElement??n.container.querySelector("canvas");n.container.addEventListener("pointerdown",k=>{if(k.pointerType==="mouse"&&l.phase===Ht.PLAYING&&!document.pointerLockElement)try{P.requestPointerLock?.()?.catch?.(()=>{})}catch{}}),document.addEventListener("mousemove",k=>{document.pointerLockElement===P&&l.phase===Ht.PLAYING&&c.look(-k.movementX*Id,-k.movementY*Id)}),document.addEventListener("pointerlockchange",()=>{!document.pointerLockElement&&l.phase===Ht.PLAYING&&b.pause()}),C.onAction((k,xt)=>{const wt=l.phase;xt!=="pressed"&&k!=="pulse"||(k==="pulse"?xt==="pressed"?wt===Ht.PLAYING?(d.unlock(),l.beginCharge()&&d.startCharge()):wt===Ht.CAUGHT&&b.respawn():xt==="released"&&wt===Ht.PLAYING&&(l.releasePulse(),d.stopCharge()):k==="pause"?wt===Ht.PLAYING?b.pause():wt===Ht.PAUSED&&performance.now()-g>250&&b.resume():k==="confirm"?wt===Ht.CAUGHT&&b.respawn():k==="mute"?b.toggleMute():k==="view"&&wt===Ht.PLAYING&&b.toggleView())}),document.addEventListener("visibilitychange",()=>{document.hidden&&b.pause()});const D=k=>{for(const xt of k)A.tip(xt.text)};l.on("*",k=>p.onEvent(k)),l.on("pulse",k=>{d.pulse(k.kind,k.loudness,{wet:k.wet}),k.kind==="full"?c.addShake(.22):k.kind==="mid"&&c.addShake(.08)}),l.on("softPulse",()=>d.pulse("tap",.3)),l.on("crystalEcho",k=>d.crystalEcho(k)),l.on("beastWake",k=>{d.growl({x:k.x,y:k.y+.7,z:k.z}),A.toast(k.cause==="wading"||k.cause==="footsteps"?"It heard you move":"Something stirs",1.8)}),l.on("beastAlert",k=>d.huff({x:k.x,y:k.y+.6,z:k.z})),l.on("beastLunge",k=>d.growl({x:k.x,y:k.y+.7,z:k.z},{short:!0})),l.on("greatWake",k=>{d.growl({x:k.x,y:k.y+1.4,z:k.z},{big:!0}),c.addShake(.8),A.toast("The Throat wakes. Climb!",3)}),l.on("step",k=>k.water?d.wade(Math.min(1,k.pace)):d.footstep(Math.min(1,k.pace)*.7)),l.on("mothCollected",k=>{d.chime(k.count),h.burst(k.x,k.y,k.z,16756794,7,{sparks:48}),A.toast(k.count>=k.required?"All five moths. The way out wakes.":`Glow-moth ${k.count} of ${k.required}`)}),l.on("exitOpened",()=>{d.exitOpened(),h.exitOpened()}),l.on("checkpoint",k=>{d.checkpoint(),h.burst(k.x,k.y,k.z,8257496,4),A.toast("Crystal lit: you will wake here")}),l.on("caught",()=>{d.stopCharge(),d.caught(),c.addShake(.6),_.setVisible(!1),document.pointerLockElement&&document.exitPointerLock?.(),A.showCaught(l.chase)}),l.on("won",k=>{const xt=l.def,wt=xt.id===me[me.length-1].id,Ct=Bf(xt,k),Y=vM(o,xt,k);o=Y.progress,Ed(o),m={...k,stars:Ct.stars},d.stopCharge(),d.win(),_.setVisible(!1),document.pointerLockElement&&document.exitPointerLock?.(),A.showResults({def:xt,result:k,...Ct,...Y,last:wt})}),n.onTick(k=>{const xt=C.sample();if(_.update(k),l.phase===Ht.PLAYING){const Y=(C.pressedActions.has("turnLeft")?1:0)-(C.pressedActions.has("turnRight")?1:0);Y&&c.look(Y*XM*k,0)}const wt=Math.max(-1,Math.min(1,xt.moveX+_.move.x)),Ct=Math.max(-1,Math.min(1,xt.moveY+_.move.y));l.update(k,{moveX:wt,moveY:Ct,yaw:c.yaw,sneak:xt.run})});let O=0,H=0;const F=new Set(["rousing","hunting","lunging","chasing"]),q=k=>{const xt=l.player;let wt=1/0;if(l.phase===Ht.PLAYING)for(const Y of l.beasts)F.has(Y.state)&&(wt=Math.min(wt,Math.hypot(Y.x-xt.x,Y.y-xt.y,Y.z-xt.z)));let Ct=0;if(wt<16){const Y=Math.max(0,Math.min(1,(16-wt)/14.5));O=(O+k*(55+Y*95)/60)%1;const nt=Math.max(Math.exp(-(((O-.06)/.055)**2)),.65*Math.exp(-(((O-.27)/.055)**2)));Ct=(.3+.7*Y)*(.3+.7*nt)}H=Ct>H?Ct:Math.max(Ct,H-k*1.5),A.flashDanger(H)},G=[];let J=performance.now(),et=0;n.onRender(k=>{const xt=performance.now();G.push(xt-J),J=xt,G.length>120&&G.shift();const wt=n.camera;wt.aspect!==et&&(et=wt.aspect,wt.fov=wt.aspect<1?Math.min(82,62+(1-wt.aspect)*34):62,wt.updateProjectionMatrix()),h.setPointScale(n.renderer.getContext().drawingBufferHeight/(2*Math.tan(wt.fov*Math.PI/360))),h.render(k);const Ct=h.creature.group.position;c.update(k,{x:Ct.x,y:Ct.y,z:Ct.z},l.terrain);const Y=l.getState();A.update(k,Y,l.def.name),l.phase===Ht.PLAYING&&D(p.update(Y,l.level.start));const nt=l.player;let it=1/0;for(const bt of l.beasts)bt.state==="sleeping"||bt.state==="dormant"||(it=Math.min(it,Math.hypot(bt.x-nt.x,bt.y-nt.y,bt.z-nt.z)));let Dt=null;for(const bt of l.moths){if(bt.collected)continue;const At=Math.hypot(bt.x-nt.x,bt.y-nt.y,bt.z-nt.z);(!Dt||At<Dt.distance)&&(Dt={distance:At,pos:{x:bt.x,y:bt.y+1,z:bt.z}})}q(k),d.setListener(nt.x,nt.y+.5,nt.z,c.yaw),d.update(k,{playing:l.phase===Ht.PLAYING,nearestMoth:Dt,danger:it,dripSpot:()=>{for(let bt=0;bt<6;bt+=1){const At=nt.x+(Math.random()-.5)*24,ce=nt.z+(Math.random()-.5)*24,kt=l.level.nav.player,Qt=Math.round(At)-1,Xt=Math.round(ce)-1;if(Qt>=0&&Xt>=0&&Qt<kt.w&&Xt<kt.h&&kt.walk[Xt*kt.w+Qt])return{x:At,y:nt.y+2.5,z:ce}}return null}})});const at=()=>G.length<10?0:1e3/(G.reduce((xt,wt)=>xt+wt,0)/G.length),rt={host:n,input:C,get rules(){return l},rig:c,audio:d,commands:b,getState:()=>({...l.getState(),screen:A.screen,fps:Math.round(at()*10)/10,camera:c.getState(),touchUI:!_.el.hidden,touchMode:f,levelName:l.def.name,quality:e,bloom:!!s?.enabled,particles:!!h.particles,pixelRatio:n.renderer.getPixelRatio(),vignette:Math.round(H*100)/100,toast:A.toastTime>0?u.root.querySelector(".eb-toast")?.textContent??"":"",progress:o,lastResult:m,tip:A.tipTime>0?u.root.querySelector(".eb-tip")?.textContent??"":""}),pathTo:(k,xt)=>yo(l.level.nav.player,l.player,{x:k,z:xt})??[]};return globalThis.__A3GAME_GAME__=rt,globalThis.__A3GAME_PLAYTEST__={warmup:.5,look:"off",actions:[{id:"select",taps:["Enter"],duration:.6},{id:"start",taps:["Enter"],duration:.8},{id:"skip_intro",taps:["Enter"],duration:.8},{id:"move_forward",keys:["KeyW"],duration:1.5},{id:"tap_pulse",taps:["Space"],duration:1.5},{id:"turn",keys:["ArrowLeft"],duration:.8},{id:"loud_pulse",keys:["Space"],duration:1.2},{id:"watch_echo",duration:2.5}]},A.showTitle(o),n.start(),rt}const Ld=r=>{console.error(r);const t=document.getElementById("boot-error");t&&(t.hidden=!1,t.textContent=`Could not start: ${r.message}`)};async function JM(){const{renderAudioLevels:r}=await Jf(async()=>{const{renderAudioLevels:i}=await import("./audiotest-d0bBXe87.js");return{renderAudioLevels:i}},[],import.meta.url),t=await r();globalThis.__AUDIO_LEVELS__=t;const e=t.cues.map(i=>`<tr><td>${i.name}</td><td>${i.peakDb}</td><td>${i.rmsDb}</td><td>${i.activeSeconds}</td><td>${i.clipping?"CLIPS":i.silent?"SILENT":"ok"}</td></tr>`).join("");document.body.style.overflow="auto",document.body.innerHTML=`<div style="font:14px system-ui;color:#d9f6ff;padding:16px"><h2>Echoes Below audio levels (${t.ok?"all pass":"FAIL"})</h2>
    <table cellpadding="4"><tr><th align=left>cue</th><th>peak dBFS</th><th>RMS dBFS</th><th>active s</th><th></th></tr>${e}</table></div>`}new URLSearchParams(location.search).has("audiotest")?JM().catch(Ld):KM().catch(Ld);export{uv as C};
