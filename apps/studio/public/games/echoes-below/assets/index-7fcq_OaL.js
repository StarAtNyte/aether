(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const r of n)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&i(a)}).observe(document,{childList:!0,subtree:!0});function e(n){const r={};return n.integrity&&(r.integrity=n.integrity),n.referrerPolicy&&(r.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?r.credentials="include":n.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(n){if(n.ep)return;n.ep=!0;const r=e(n);fetch(n.href,r)}})();/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const lh="185",Fs={ROTATE:0,DOLLY:1,PAN:2},Is={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},jd=0,Zh=1,tf=2,Pa=1,Yu=2,fr=3,bn=0,Le=1,Yi=2,Zi=0,Us=1,Kh=2,Jh=3,Qh=4,ef=5,On=100,nf=101,sf=102,rf=103,af=104,of=200,lf=201,hf=202,cf=203,ul=204,dl=205,uf=206,df=207,ff=208,pf=209,mf=210,gf=211,xf=212,_f=213,yf=214,fl=0,pl=1,ml=2,Vs=3,gl=4,xl=5,_l=6,yl=7,hh=0,Mf=1,vf=2,yi=0,ch=1,uh=2,dh=3,fh=4,$u=5,ph=6,Qa=7,Zu=300,Gn=301,Gs=302,mr=303,ro=304,ja=306,Ml=1e3,$i=1001,vl=1002,Ie=1003,Sf=1004,Ir=1005,Be=1006,ao=1007,kn=1008,ei=1009,Ku=1010,Ju=1011,yr=1012,mh=1013,Fi=1014,xi=1015,Qi=1016,gh=1017,xh=1018,Mr=1020,Qu=35902,ju=35899,td=1021,ed=1022,_i=1023,ji=1026,Vn=1027,_h=1028,yh=1029,Hn=1030,Mh=1031,vh=1033,Da=33776,Ia=33777,La=33778,Na=33779,Sl=35840,bl=35841,El=35842,wl=35843,Tl=36196,Al=37492,Rl=37496,Cl=37488,Pl=37489,Va=37490,Dl=37491,Il=37808,Ll=37809,Nl=37810,Fl=37811,Ul=37812,Ol=37813,zl=37814,Bl=37815,kl=37816,Vl=37817,Gl=37818,Hl=37819,Wl=37820,Xl=37821,ql=36492,Yl=36494,$l=36495,Zl=36283,Kl=36284,Ga=36285,Jl=36286,bf=3200,Ha=0,Ef=1,_n="",je="srgb",Wa="srgb-linear",Xa="linear",Kt="srgb",Zn=7680,jh=519,wf=512,Tf=513,Af=514,Sh=515,Rf=516,Cf=517,bh=518,Pf=519,tc=35044,ec="300 es",Di=2e3,vr=2001;function Df(s){for(let t=s.length-1;t>=0;--t)if(s[t]>=65535)return!0;return!1}function qa(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function If(){const s=qa("canvas");return s.style.display="block",s}const ic={};function nc(...s){const t="THREE."+s.shift();console.log(t,...s)}function id(s){const t=s[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=s[1];e&&e.isStackTrace?s[0]+=" "+e.getLocation():s[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return s}function Rt(...s){s=id(s);const t="THREE."+s.shift();{const e=s[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...s)}}function Gt(...s){s=id(s);const t="THREE."+s.shift();{const e=s[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...s)}}function Os(...s){const t=s.join(" ");t in ic||(ic[t]=!0,Rt(...s))}function Lf(s,t,e){return new Promise(function(i,n){function r(){switch(s.clientWaitSync(t,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:n();break;case s.TIMEOUT_EXPIRED:setTimeout(r,e);break;default:i()}}setTimeout(r,e)})}const Nf={[fl]:pl,[ml]:_l,[gl]:yl,[Vs]:xl,[pl]:fl,[_l]:ml,[yl]:gl,[xl]:Vs};let Tn=class{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(e)===-1&&i[t].push(e)}hasEventListener(t,e){const i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(e)!==-1}removeEventListener(t,e){const i=this._listeners;if(i===void 0)return;const n=i[t];if(n!==void 0){const r=n.indexOf(e);r!==-1&&n.splice(r,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const i=e[t.type];if(i!==void 0){t.target=this;const n=i.slice(0);for(let r=0,a=n.length;r<a;r++)n[r].call(this,t);t.target=null}}};const Fe=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let sc=1234567;const gr=Math.PI/180,Sr=180/Math.PI;function Xs(){const s=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(Fe[s&255]+Fe[s>>8&255]+Fe[s>>16&255]+Fe[s>>24&255]+"-"+Fe[t&255]+Fe[t>>8&255]+"-"+Fe[t>>16&15|64]+Fe[t>>24&255]+"-"+Fe[e&63|128]+Fe[e>>8&255]+"-"+Fe[e>>16&255]+Fe[e>>24&255]+Fe[i&255]+Fe[i>>8&255]+Fe[i>>16&255]+Fe[i>>24&255]).toLowerCase()}function zt(s,t,e){return Math.max(t,Math.min(e,s))}function Eh(s,t){return(s%t+t)%t}function Ff(s,t,e,i,n){return i+(s-t)*(n-i)/(e-t)}function Uf(s,t,e){return s!==t?(e-s)/(t-s):0}function xr(s,t,e){return(1-e)*s+e*t}function Of(s,t,e,i){return xr(s,t,1-Math.exp(-e*i))}function zf(s,t=1){return t-Math.abs(Eh(s,t*2)-t)}function Bf(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*(3-2*s))}function kf(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*s*(s*(s*6-15)+10))}function Vf(s,t){return s+Math.floor(Math.random()*(t-s+1))}function Gf(s,t){return s+Math.random()*(t-s)}function Hf(s){return s*(.5-Math.random())}function Wf(s){s!==void 0&&(sc=s);let t=sc+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function Xf(s){return s*gr}function qf(s){return s*Sr}function Yf(s){return(s&s-1)===0&&s!==0}function $f(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function Zf(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function Kf(s,t,e,i,n){const r=Math.cos,a=Math.sin,o=r(e/2),l=a(e/2),h=r((t+i)/2),u=a((t+i)/2),d=r((t-i)/2),c=a((t-i)/2),f=r((i-t)/2),g=a((i-t)/2);switch(n){case"XYX":s.set(o*u,l*d,l*c,o*h);break;case"YZY":s.set(l*c,o*u,l*d,o*h);break;case"ZXZ":s.set(l*d,l*c,o*u,o*h);break;case"XZX":s.set(o*u,l*g,l*f,o*h);break;case"YXY":s.set(l*f,o*u,l*g,o*h);break;case"ZYZ":s.set(l*g,l*f,o*u,o*h);break;default:Rt("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+n)}}function Ps(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function Ge(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}const Ql={DEG2RAD:gr,RAD2DEG:Sr,generateUUID:Xs,clamp:zt,euclideanModulo:Eh,mapLinear:Ff,inverseLerp:Uf,lerp:xr,damp:Of,pingpong:zf,smoothstep:Bf,smootherstep:kf,randInt:Vf,randFloat:Gf,randFloatSpread:Hf,seededRandom:Wf,degToRad:Xf,radToDeg:qf,isPowerOfTwo:Yf,ceilPowerOfTwo:$f,floorPowerOfTwo:Zf,setQuaternionFromProperEuler:Kf,normalize:Ge,denormalize:Ps};let Pt=class nd{static{nd.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,i=this.y,n=t.elements;return this.x=n[0]*e+n[3]*i+n[6],this.y=n[1]*e+n[4]*i+n[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=zt(this.x,t.x,e.x),this.y=zt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=zt(this.x,t,e),this.y=zt(this.y,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(zt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(zt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y;return e*e+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const i=Math.cos(e),n=Math.sin(e),r=this.x-t.x,a=this.y-t.y;return this.x=r*i-a*n+t.x,this.y=r*n+a*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},En=class{constructor(t=0,e=0,i=0,n=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=i,this._w=n}static slerpFlat(t,e,i,n,r,a,o){let l=i[n+0],h=i[n+1],u=i[n+2],d=i[n+3],c=r[a+0],f=r[a+1],g=r[a+2],_=r[a+3];if(d!==_||l!==c||h!==f||u!==g){let m=l*c+h*f+u*g+d*_;m<0&&(c=-c,f=-f,g=-g,_=-_,m=-m);let p=1-o;if(m<.9995){const v=Math.acos(m),E=Math.sin(v);p=Math.sin(p*v)/E,o=Math.sin(o*v)/E,l=l*p+c*o,h=h*p+f*o,u=u*p+g*o,d=d*p+_*o}else{l=l*p+c*o,h=h*p+f*o,u=u*p+g*o,d=d*p+_*o;const v=1/Math.sqrt(l*l+h*h+u*u+d*d);l*=v,h*=v,u*=v,d*=v}}t[e]=l,t[e+1]=h,t[e+2]=u,t[e+3]=d}static multiplyQuaternionsFlat(t,e,i,n,r,a){const o=i[n],l=i[n+1],h=i[n+2],u=i[n+3],d=r[a],c=r[a+1],f=r[a+2],g=r[a+3];return t[e]=o*g+u*d+l*f-h*c,t[e+1]=l*g+u*c+h*d-o*f,t[e+2]=h*g+u*f+o*c-l*d,t[e+3]=u*g-o*d-l*c-h*f,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,i,n){return this._x=t,this._y=e,this._z=i,this._w=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const i=t._x,n=t._y,r=t._z,a=t._order,o=Math.cos,l=Math.sin,h=o(i/2),u=o(n/2),d=o(r/2),c=l(i/2),f=l(n/2),g=l(r/2);switch(a){case"XYZ":this._x=c*u*d+h*f*g,this._y=h*f*d-c*u*g,this._z=h*u*g+c*f*d,this._w=h*u*d-c*f*g;break;case"YXZ":this._x=c*u*d+h*f*g,this._y=h*f*d-c*u*g,this._z=h*u*g-c*f*d,this._w=h*u*d+c*f*g;break;case"ZXY":this._x=c*u*d-h*f*g,this._y=h*f*d+c*u*g,this._z=h*u*g+c*f*d,this._w=h*u*d-c*f*g;break;case"ZYX":this._x=c*u*d-h*f*g,this._y=h*f*d+c*u*g,this._z=h*u*g-c*f*d,this._w=h*u*d+c*f*g;break;case"YZX":this._x=c*u*d+h*f*g,this._y=h*f*d+c*u*g,this._z=h*u*g-c*f*d,this._w=h*u*d-c*f*g;break;case"XZY":this._x=c*u*d-h*f*g,this._y=h*f*d-c*u*g,this._z=h*u*g+c*f*d,this._w=h*u*d+c*f*g;break;default:Rt("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const i=e/2,n=Math.sin(i);return this._x=t.x*n,this._y=t.y*n,this._z=t.z*n,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,i=e[0],n=e[4],r=e[8],a=e[1],o=e[5],l=e[9],h=e[2],u=e[6],d=e[10],c=i+o+d;if(c>0){const f=.5/Math.sqrt(c+1);this._w=.25/f,this._x=(u-l)*f,this._y=(r-h)*f,this._z=(a-n)*f}else if(i>o&&i>d){const f=2*Math.sqrt(1+i-o-d);this._w=(u-l)/f,this._x=.25*f,this._y=(n+a)/f,this._z=(r+h)/f}else if(o>d){const f=2*Math.sqrt(1+o-i-d);this._w=(r-h)/f,this._x=(n+a)/f,this._y=.25*f,this._z=(l+u)/f}else{const f=2*Math.sqrt(1+d-i-o);this._w=(a-n)/f,this._x=(r+h)/f,this._y=(l+u)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let i=t.dot(e)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(zt(this.dot(t),-1,1)))}rotateTowards(t,e){const i=this.angleTo(t);if(i===0)return this;const n=Math.min(1,e/i);return this.slerp(t,n),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const i=t._x,n=t._y,r=t._z,a=t._w,o=e._x,l=e._y,h=e._z,u=e._w;return this._x=i*u+a*o+n*h-r*l,this._y=n*u+a*l+r*o-i*h,this._z=r*u+a*h+i*l-n*o,this._w=a*u-i*o-n*l-r*h,this._onChangeCallback(),this}slerp(t,e){let i=t._x,n=t._y,r=t._z,a=t._w,o=this.dot(t);o<0&&(i=-i,n=-n,r=-r,a=-a,o=-o);let l=1-e;if(o<.9995){const h=Math.acos(o),u=Math.sin(h);l=Math.sin(l*h)/u,e=Math.sin(e*h)/u,this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+r*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+r*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,i){return this.copy(t).slerp(e,i)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),i=Math.random(),n=Math.sqrt(1-i),r=Math.sqrt(i);return this.set(n*Math.sin(t),n*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},U=class sd{static{sd.prototype.isVector3=!0}constructor(t=0,e=0,i=0){this.x=t,this.y=e,this.z=i}set(t,e,i){return i===void 0&&(i=this.z),this.x=t,this.y=e,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(rc.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(rc.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,i=this.y,n=this.z,r=t.elements;return this.x=r[0]*e+r[3]*i+r[6]*n,this.y=r[1]*e+r[4]*i+r[7]*n,this.z=r[2]*e+r[5]*i+r[8]*n,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,r=t.elements,a=1/(r[3]*e+r[7]*i+r[11]*n+r[15]);return this.x=(r[0]*e+r[4]*i+r[8]*n+r[12])*a,this.y=(r[1]*e+r[5]*i+r[9]*n+r[13])*a,this.z=(r[2]*e+r[6]*i+r[10]*n+r[14])*a,this}applyQuaternion(t){const e=this.x,i=this.y,n=this.z,r=t.x,a=t.y,o=t.z,l=t.w,h=2*(a*n-o*i),u=2*(o*e-r*n),d=2*(r*i-a*e);return this.x=e+l*h+a*d-o*u,this.y=i+l*u+o*h-r*d,this.z=n+l*d+r*u-a*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,i=this.y,n=this.z,r=t.elements;return this.x=r[0]*e+r[4]*i+r[8]*n,this.y=r[1]*e+r[5]*i+r[9]*n,this.z=r[2]*e+r[6]*i+r[10]*n,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=zt(this.x,t.x,e.x),this.y=zt(this.y,t.y,e.y),this.z=zt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=zt(this.x,t,e),this.y=zt(this.y,t,e),this.z=zt(this.z,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(zt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const i=t.x,n=t.y,r=t.z,a=e.x,o=e.y,l=e.z;return this.x=n*l-r*o,this.y=r*a-i*l,this.z=i*o-n*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const i=t.dot(this)/e;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return oo.copy(this).projectOnVector(t),this.sub(oo)}reflect(t){return this.sub(oo.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(zt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y,n=this.z-t.z;return e*e+i*i+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,i){const n=Math.sin(e)*t;return this.x=n*Math.sin(i),this.y=Math.cos(e)*t,this.z=n*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,i){return this.x=t*Math.sin(e),this.y=i,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),n=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=i,this.z=n,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,i=Math.sqrt(1-e*e);return this.x=i*Math.cos(t),this.y=e,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};const oo=new U,rc=new En;let Ft=class rd{static{rd.prototype.isMatrix3=!0}constructor(t,e,i,n,r,a,o,l,h){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,i,n,r,a,o,l,h)}set(t,e,i,n,r,a,o,l,h){const u=this.elements;return u[0]=t,u[1]=n,u[2]=o,u[3]=e,u[4]=r,u[5]=l,u[6]=i,u[7]=a,u[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],this}extractBasis(t,e,i){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,r=this.elements,a=i[0],o=i[3],l=i[6],h=i[1],u=i[4],d=i[7],c=i[2],f=i[5],g=i[8],_=n[0],m=n[3],p=n[6],v=n[1],E=n[4],M=n[7],T=n[2],b=n[5],A=n[8];return r[0]=a*_+o*v+l*T,r[3]=a*m+o*E+l*b,r[6]=a*p+o*M+l*A,r[1]=h*_+u*v+d*T,r[4]=h*m+u*E+d*b,r[7]=h*p+u*M+d*A,r[2]=c*_+f*v+g*T,r[5]=c*m+f*E+g*b,r[8]=c*p+f*M+g*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[1],n=t[2],r=t[3],a=t[4],o=t[5],l=t[6],h=t[7],u=t[8];return e*a*u-e*o*h-i*r*u+i*o*l+n*r*h-n*a*l}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],r=t[3],a=t[4],o=t[5],l=t[6],h=t[7],u=t[8],d=u*a-o*h,c=o*l-u*r,f=h*r-a*l,g=e*d+i*c+n*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return t[0]=d*_,t[1]=(n*h-u*i)*_,t[2]=(o*i-n*a)*_,t[3]=c*_,t[4]=(u*e-n*l)*_,t[5]=(n*r-o*e)*_,t[6]=f*_,t[7]=(i*l-h*e)*_,t[8]=(a*e-i*r)*_,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,i,n,r,a,o){const l=Math.cos(r),h=Math.sin(r);return this.set(i*l,i*h,-i*(l*a+h*o)+a+t,-n*h,n*l,-n*(-h*a+l*o)+o+e,0,0,1),this}scale(t,e){return Os("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(lo.makeScale(t,e)),this}rotate(t){return Os("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(lo.makeRotation(-t)),this}translate(t,e){return Os("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(lo.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,i,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<9;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<9;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}};const lo=new Ft,ac=new Ft().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),oc=new Ft().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Jf(){const s={enabled:!0,workingColorSpace:Wa,spaces:{},convert:function(n,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===Kt&&(n.r=Ki(n.r),n.g=Ki(n.g),n.b=Ki(n.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(n.applyMatrix3(this.spaces[r].toXYZ),n.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===Kt&&(n.r=zs(n.r),n.g=zs(n.g),n.b=zs(n.b))),n},workingToColorSpace:function(n,r){return this.convert(n,this.workingColorSpace,r)},colorSpaceToWorking:function(n,r){return this.convert(n,r,this.workingColorSpace)},getPrimaries:function(n){return this.spaces[n].primaries},getTransfer:function(n){return n===_n?Xa:this.spaces[n].transfer},getToneMappingMode:function(n){return this.spaces[n].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(n,r=this.workingColorSpace){return n.fromArray(this.spaces[r].luminanceCoefficients)},define:function(n){Object.assign(this.spaces,n)},_getMatrix:function(n,r,a){return n.copy(this.spaces[r].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(n){return this.spaces[n].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(n=this.workingColorSpace){return this.spaces[n].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(n,r){return Os("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(n,r)},toWorkingColorSpace:function(n,r){return Os("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(n,r)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],i=[.3127,.329];return s.define({[Wa]:{primaries:t,whitePoint:i,transfer:Xa,toXYZ:ac,fromXYZ:oc,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:je},outputColorSpaceConfig:{drawingBufferColorSpace:je}},[je]:{primaries:t,whitePoint:i,transfer:Kt,toXYZ:ac,fromXYZ:oc,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:je}}}),s}const kt=Jf();function Ki(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function zs(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}let Kn,Qf=class{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{Kn===void 0&&(Kn=qa("canvas")),Kn.width=t.width,Kn.height=t.height;const n=Kn.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),i=Kn}return i.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=qa("canvas");e.width=t.width,e.height=t.height;const i=e.getContext("2d");i.drawImage(t,0,0,t.width,t.height);const n=i.getImageData(0,0,t.width,t.height),r=n.data;for(let a=0;a<r.length;a++)r[a]=Ki(r[a]/255)*255;return i.putImageData(n,0,0),e}else if(t.data){const e=t.data.slice(0);for(let i=0;i<e.length;i++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[i]=Math.floor(Ki(e[i]/255)*255):e[i]=Ki(e[i]);return{data:e,width:t.width,height:t.height}}else return Rt("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},jf=0,wh=class{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:jf++}),this.uuid=Xs(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const i={uuid:this.uuid,url:""},n=this.data;if(n!==null){let r;if(Array.isArray(n)){r=[];for(let a=0,o=n.length;a<o;a++)n[a].isDataTexture?r.push(ho(n[a].image)):r.push(ho(n[a]))}else r=ho(n);i.url=r}return e||(t.images[this.uuid]=i),i}};function ho(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?Qf.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(Rt("Texture: Unable to serialize Texture."),{})}let tp=0;const co=new U;let vi=class Fa extends Tn{constructor(t=Fa.DEFAULT_IMAGE,e=Fa.DEFAULT_MAPPING,i=$i,n=$i,r=Be,a=kn,o=_i,l=ei,h=Fa.DEFAULT_ANISOTROPY,u=_n){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:tp++}),this.uuid=Xs(),this.name="",this.source=new wh(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=i,this.wrapT=n,this.magFilter=r,this.minFilter=a,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Pt(0,0),this.repeat=new Pt(1,1),this.center=new Pt(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ft,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(co).x}get height(){return this.source.getSize(co).y}get depth(){return this.source.getSize(co).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const i=t[e];if(i===void 0){Rt(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Rt(`Texture.setValues(): property '${e}' does not exist.`);continue}n&&i&&n.isVector2&&i.isVector2||n&&i&&n.isVector3&&i.isVector3||n&&i&&n.isMatrix3&&i.isMatrix3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),e||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==Zu)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Ml:t.x=t.x-Math.floor(t.x);break;case $i:t.x=t.x<0?0:1;break;case vl:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Ml:t.y=t.y-Math.floor(t.y);break;case $i:t.y=t.y<0?0:1;break;case vl:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};vi.DEFAULT_IMAGE=null;vi.DEFAULT_MAPPING=Zu;vi.DEFAULT_ANISOTROPY=1;let me=class ad{static{ad.prototype.isVector4=!0}constructor(t=0,e=0,i=0,n=1){this.x=t,this.y=e,this.z=i,this.w=n}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,i,n){return this.x=t,this.y=e,this.z=i,this.w=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,r=this.w,a=t.elements;return this.x=a[0]*e+a[4]*i+a[8]*n+a[12]*r,this.y=a[1]*e+a[5]*i+a[9]*n+a[13]*r,this.z=a[2]*e+a[6]*i+a[10]*n+a[14]*r,this.w=a[3]*e+a[7]*i+a[11]*n+a[15]*r,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,i,n,r;const l=t.elements,h=l[0],u=l[4],d=l[8],c=l[1],f=l[5],g=l[9],_=l[2],m=l[6],p=l[10];if(Math.abs(u-c)<.01&&Math.abs(d-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(u+c)<.1&&Math.abs(d+_)<.1&&Math.abs(g+m)<.1&&Math.abs(h+f+p-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const E=(h+1)/2,M=(f+1)/2,T=(p+1)/2,b=(u+c)/4,A=(d+_)/4,x=(g+m)/4;return E>M&&E>T?E<.01?(i=0,n=.707106781,r=.707106781):(i=Math.sqrt(E),n=b/i,r=A/i):M>T?M<.01?(i=.707106781,n=0,r=.707106781):(n=Math.sqrt(M),i=b/n,r=x/n):T<.01?(i=.707106781,n=.707106781,r=0):(r=Math.sqrt(T),i=A/r,n=x/r),this.set(i,n,r,e),this}let v=Math.sqrt((m-g)*(m-g)+(d-_)*(d-_)+(c-u)*(c-u));return Math.abs(v)<.001&&(v=1),this.x=(m-g)/v,this.y=(d-_)/v,this.z=(c-u)/v,this.w=Math.acos((h+f+p-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=zt(this.x,t.x,e.x),this.y=zt(this.y,t.y,e.y),this.z=zt(this.z,t.z,e.z),this.w=zt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=zt(this.x,t,e),this.y=zt(this.y,t,e),this.z=zt(this.z,t,e),this.w=zt(this.w,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(zt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this.w=t.w+(e.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};class ep extends Tn{constructor(t=1,e=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Be,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},i),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=i.depth,this.scissor=new me(0,0,t,e),this.scissorTest=!1,this.viewport=new me(0,0,t,e),this.textures=[];const n={width:t,height:e,depth:i.depth},r=new vi(n),a=i.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview,this.useArrayDepthTexture=i.useArrayDepthTexture}_setTextureOptions(t={}){const e={minFilter:Be,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,i=1){if(this.width!==t||this.height!==e||this.depth!==i){this.width=t,this.height=e,this.depth=i;for(let n=0,r=this.textures.length;n<r;n++)this.textures[n].image.width=t,this.textures[n].image.height=e,this.textures[n].image.depth=i,this.textures[n].isData3DTexture!==!0&&(this.textures[n].isArrayTexture=this.textures[n].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,i=t.textures.length;e<i;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const n=Object.assign({},t.textures[e].image);this.textures[e].source=new wh(n)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Li extends ep{constructor(t=1,e=1,i={}){super(t,e,i),this.isWebGLRenderTarget=!0}}class od extends vi{constructor(t=null,e=1,i=1,n=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:i,depth:n},this.magFilter=Ie,this.minFilter=Ie,this.wrapR=$i,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class ip extends vi{constructor(t=null,e=1,i=1,n=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:i,depth:n},this.magFilter=Ie,this.minFilter=Ie,this.wrapR=$i,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}let oe=class jl{static{jl.prototype.isMatrix4=!0}constructor(t,e,i,n,r,a,o,l,h,u,d,c,f,g,_,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,i,n,r,a,o,l,h,u,d,c,f,g,_,m)}set(t,e,i,n,r,a,o,l,h,u,d,c,f,g,_,m){const p=this.elements;return p[0]=t,p[4]=e,p[8]=i,p[12]=n,p[1]=r,p[5]=a,p[9]=o,p[13]=l,p[2]=h,p[6]=u,p[10]=d,p[14]=c,p[3]=f,p[7]=g,p[11]=_,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new jl().fromArray(this.elements)}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],e[9]=i[9],e[10]=i[10],e[11]=i[11],e[12]=i[12],e[13]=i[13],e[14]=i[14],e[15]=i[15],this}copyPosition(t){const e=this.elements,i=t.elements;return e[12]=i[12],e[13]=i[13],e[14]=i[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,i){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,e,i){return this.set(t.x,e.x,i.x,0,t.y,e.y,i.y,0,t.z,e.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,i=t.elements,n=1/Jn.setFromMatrixColumn(t,0).length(),r=1/Jn.setFromMatrixColumn(t,1).length(),a=1/Jn.setFromMatrixColumn(t,2).length();return e[0]=i[0]*n,e[1]=i[1]*n,e[2]=i[2]*n,e[3]=0,e[4]=i[4]*r,e[5]=i[5]*r,e[6]=i[6]*r,e[7]=0,e[8]=i[8]*a,e[9]=i[9]*a,e[10]=i[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,i=t.x,n=t.y,r=t.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(n),h=Math.sin(n),u=Math.cos(r),d=Math.sin(r);if(t.order==="XYZ"){const c=a*u,f=a*d,g=o*u,_=o*d;e[0]=l*u,e[4]=-l*d,e[8]=h,e[1]=f+g*h,e[5]=c-_*h,e[9]=-o*l,e[2]=_-c*h,e[6]=g+f*h,e[10]=a*l}else if(t.order==="YXZ"){const c=l*u,f=l*d,g=h*u,_=h*d;e[0]=c+_*o,e[4]=g*o-f,e[8]=a*h,e[1]=a*d,e[5]=a*u,e[9]=-o,e[2]=f*o-g,e[6]=_+c*o,e[10]=a*l}else if(t.order==="ZXY"){const c=l*u,f=l*d,g=h*u,_=h*d;e[0]=c-_*o,e[4]=-a*d,e[8]=g+f*o,e[1]=f+g*o,e[5]=a*u,e[9]=_-c*o,e[2]=-a*h,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const c=a*u,f=a*d,g=o*u,_=o*d;e[0]=l*u,e[4]=g*h-f,e[8]=c*h+_,e[1]=l*d,e[5]=_*h+c,e[9]=f*h-g,e[2]=-h,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const c=a*l,f=a*h,g=o*l,_=o*h;e[0]=l*u,e[4]=_-c*d,e[8]=g*d+f,e[1]=d,e[5]=a*u,e[9]=-o*u,e[2]=-h*u,e[6]=f*d+g,e[10]=c-_*d}else if(t.order==="XZY"){const c=a*l,f=a*h,g=o*l,_=o*h;e[0]=l*u,e[4]=-d,e[8]=h*u,e[1]=c*d+_,e[5]=a*u,e[9]=f*d-g,e[2]=g*d-f,e[6]=o*u,e[10]=_*d+c}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(np,t,sp)}lookAt(t,e,i){const n=this.elements;return Ze.subVectors(t,e),Ze.lengthSq()===0&&(Ze.z=1),Ze.normalize(),rn.crossVectors(i,Ze),rn.lengthSq()===0&&(Math.abs(i.z)===1?Ze.x+=1e-4:Ze.z+=1e-4,Ze.normalize(),rn.crossVectors(i,Ze)),rn.normalize(),Lr.crossVectors(Ze,rn),n[0]=rn.x,n[4]=Lr.x,n[8]=Ze.x,n[1]=rn.y,n[5]=Lr.y,n[9]=Ze.y,n[2]=rn.z,n[6]=Lr.z,n[10]=Ze.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,r=this.elements,a=i[0],o=i[4],l=i[8],h=i[12],u=i[1],d=i[5],c=i[9],f=i[13],g=i[2],_=i[6],m=i[10],p=i[14],v=i[3],E=i[7],M=i[11],T=i[15],b=n[0],A=n[4],x=n[8],w=n[12],C=n[1],P=n[5],D=n[9],z=n[13],X=n[2],N=n[6],Y=n[10],V=n[14],Q=n[3],tt=n[7],nt=n[11],ct=n[15];return r[0]=a*b+o*C+l*X+h*Q,r[4]=a*A+o*P+l*N+h*tt,r[8]=a*x+o*D+l*Y+h*nt,r[12]=a*w+o*z+l*V+h*ct,r[1]=u*b+d*C+c*X+f*Q,r[5]=u*A+d*P+c*N+f*tt,r[9]=u*x+d*D+c*Y+f*nt,r[13]=u*w+d*z+c*V+f*ct,r[2]=g*b+_*C+m*X+p*Q,r[6]=g*A+_*P+m*N+p*tt,r[10]=g*x+_*D+m*Y+p*nt,r[14]=g*w+_*z+m*V+p*ct,r[3]=v*b+E*C+M*X+T*Q,r[7]=v*A+E*P+M*N+T*tt,r[11]=v*x+E*D+M*Y+T*nt,r[15]=v*w+E*z+M*V+T*ct,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[4],n=t[8],r=t[12],a=t[1],o=t[5],l=t[9],h=t[13],u=t[2],d=t[6],c=t[10],f=t[14],g=t[3],_=t[7],m=t[11],p=t[15],v=l*f-h*c,E=o*f-h*d,M=o*c-l*d,T=a*f-h*u,b=a*c-l*u,A=a*d-o*u;return e*(_*v-m*E+p*M)-i*(g*v-m*T+p*b)+n*(g*E-_*T+p*A)-r*(g*M-_*b+m*A)}determinantAffine(){const t=this.elements,e=t[0],i=t[4],n=t[8],r=t[1],a=t[5],o=t[9],l=t[2],h=t[6],u=t[10];return e*(a*u-o*h)-i*(r*u-o*l)+n*(r*h-a*l)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,i){const n=this.elements;return t.isVector3?(n[12]=t.x,n[13]=t.y,n[14]=t.z):(n[12]=t,n[13]=e,n[14]=i),this}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],r=t[3],a=t[4],o=t[5],l=t[6],h=t[7],u=t[8],d=t[9],c=t[10],f=t[11],g=t[12],_=t[13],m=t[14],p=t[15],v=e*o-i*a,E=e*l-n*a,M=e*h-r*a,T=i*l-n*o,b=i*h-r*o,A=n*h-r*l,x=u*_-d*g,w=u*m-c*g,C=u*p-f*g,P=d*m-c*_,D=d*p-f*_,z=c*p-f*m,X=v*z-E*D+M*P+T*C-b*w+A*x;if(X===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const N=1/X;return t[0]=(o*z-l*D+h*P)*N,t[1]=(n*D-i*z-r*P)*N,t[2]=(_*A-m*b+p*T)*N,t[3]=(c*b-d*A-f*T)*N,t[4]=(l*C-a*z-h*w)*N,t[5]=(e*z-n*C+r*w)*N,t[6]=(m*M-g*A-p*E)*N,t[7]=(u*A-c*M+f*E)*N,t[8]=(a*D-o*C+h*x)*N,t[9]=(i*C-e*D-r*x)*N,t[10]=(g*b-_*M+p*v)*N,t[11]=(d*M-u*b-f*v)*N,t[12]=(o*w-a*P-l*x)*N,t[13]=(e*P-i*w+n*x)*N,t[14]=(_*E-g*T-m*v)*N,t[15]=(u*T-d*E+c*v)*N,this}scale(t){const e=this.elements,i=t.x,n=t.y,r=t.z;return e[0]*=i,e[4]*=n,e[8]*=r,e[1]*=i,e[5]*=n,e[9]*=r,e[2]*=i,e[6]*=n,e[10]*=r,e[3]*=i,e[7]*=n,e[11]*=r,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],n=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,i,n))}makeTranslation(t,e,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,i,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,e,-i,0,0,i,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,0,i,0,0,1,0,0,-i,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,0,i,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const i=Math.cos(e),n=Math.sin(e),r=1-i,a=t.x,o=t.y,l=t.z,h=r*a,u=r*o;return this.set(h*a+i,h*o-n*l,h*l+n*o,0,h*o+n*l,u*o+i,u*l-n*a,0,h*l-n*o,u*l+n*a,r*l*l+i,0,0,0,0,1),this}makeScale(t,e,i){return this.set(t,0,0,0,0,e,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,e,i,n,r,a){return this.set(1,i,r,0,t,1,a,0,e,n,1,0,0,0,0,1),this}compose(t,e,i){const n=this.elements,r=e._x,a=e._y,o=e._z,l=e._w,h=r+r,u=a+a,d=o+o,c=r*h,f=r*u,g=r*d,_=a*u,m=a*d,p=o*d,v=l*h,E=l*u,M=l*d,T=i.x,b=i.y,A=i.z;return n[0]=(1-(_+p))*T,n[1]=(f+M)*T,n[2]=(g-E)*T,n[3]=0,n[4]=(f-M)*b,n[5]=(1-(c+p))*b,n[6]=(m+v)*b,n[7]=0,n[8]=(g+E)*A,n[9]=(m-v)*A,n[10]=(1-(c+_))*A,n[11]=0,n[12]=t.x,n[13]=t.y,n[14]=t.z,n[15]=1,this}decompose(t,e,i){const n=this.elements;t.x=n[12],t.y=n[13],t.z=n[14];const r=this.determinantAffine();if(r===0)return i.set(1,1,1),e.identity(),this;let a=Jn.set(n[0],n[1],n[2]).length();const o=Jn.set(n[4],n[5],n[6]).length(),l=Jn.set(n[8],n[9],n[10]).length();r<0&&(a=-a),ci.copy(this);const h=1/a,u=1/o,d=1/l;return ci.elements[0]*=h,ci.elements[1]*=h,ci.elements[2]*=h,ci.elements[4]*=u,ci.elements[5]*=u,ci.elements[6]*=u,ci.elements[8]*=d,ci.elements[9]*=d,ci.elements[10]*=d,e.setFromRotationMatrix(ci),i.x=a,i.y=o,i.z=l,this}makePerspective(t,e,i,n,r,a,o=Di,l=!1){const h=this.elements,u=2*r/(e-t),d=2*r/(i-n),c=(e+t)/(e-t),f=(i+n)/(i-n);let g,_;if(l)g=r/(a-r),_=a*r/(a-r);else if(o===Di)g=-(a+r)/(a-r),_=-2*a*r/(a-r);else if(o===vr)g=-a/(a-r),_=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=u,h[4]=0,h[8]=c,h[12]=0,h[1]=0,h[5]=d,h[9]=f,h[13]=0,h[2]=0,h[6]=0,h[10]=g,h[14]=_,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,e,i,n,r,a,o=Di,l=!1){const h=this.elements,u=2/(e-t),d=2/(i-n),c=-(e+t)/(e-t),f=-(i+n)/(i-n);let g,_;if(l)g=1/(a-r),_=a/(a-r);else if(o===Di)g=-2/(a-r),_=-(a+r)/(a-r);else if(o===vr)g=-1/(a-r),_=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=u,h[4]=0,h[8]=0,h[12]=c,h[1]=0,h[5]=d,h[9]=0,h[13]=f,h[2]=0,h[6]=0,h[10]=g,h[14]=_,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<16;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<16;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t[e+9]=i[9],t[e+10]=i[10],t[e+11]=i[11],t[e+12]=i[12],t[e+13]=i[13],t[e+14]=i[14],t[e+15]=i[15],t}};const Jn=new U,ci=new oe,np=new U(0,0,0),sp=new U(1,1,1),rn=new U,Lr=new U,Ze=new U,lc=new oe,hc=new En;let wn=class ld{constructor(t=0,e=0,i=0,n=ld.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=i,this._order=n}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,i,n=this._order){return this._x=t,this._y=e,this._z=i,this._order=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,i=!0){const n=t.elements,r=n[0],a=n[4],o=n[8],l=n[1],h=n[5],u=n[9],d=n[2],c=n[6],f=n[10];switch(e){case"XYZ":this._y=Math.asin(zt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-u,f),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(c,h),this._z=0);break;case"YXZ":this._x=Math.asin(-zt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-d,r),this._z=0);break;case"ZXY":this._x=Math.asin(zt(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-a,h)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-zt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(c,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,h));break;case"YZX":this._z=Math.asin(zt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,h),this._y=Math.atan2(-d,r)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-zt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(c,h),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-u,f),this._y=0);break;default:Rt("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,i){return lc.makeRotationFromQuaternion(t),this.setFromRotationMatrix(lc,e,i)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return hc.setFromEuler(this),this.setFromQuaternion(hc,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};wn.DEFAULT_ORDER="XYZ";let Th=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},rp=0;const cc=new U,Qn=new En,Oi=new oe,Nr=new U,$s=new U,ap=new U,op=new En,uc=new U(1,0,0),dc=new U(0,1,0),fc=new U(0,0,1),pc={type:"added"},lp={type:"removed"},jn={type:"childadded",child:null},uo={type:"childremoved",child:null};let Si=class Ua extends Tn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:rp++}),this.uuid=Xs(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Ua.DEFAULT_UP.clone();const t=new U,e=new wn,i=new En,n=new U(1,1,1);function r(){i.setFromEuler(e,!1)}function a(){e.setFromQuaternion(i,void 0,!1)}e._onChange(r),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:n},modelViewMatrix:{value:new oe},normalMatrix:{value:new Ft}}),this.matrix=new oe,this.matrixWorld=new oe,this.matrixAutoUpdate=Ua.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Ua.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Th,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return Qn.setFromAxisAngle(t,e),this.quaternion.multiply(Qn),this}rotateOnWorldAxis(t,e){return Qn.setFromAxisAngle(t,e),this.quaternion.premultiply(Qn),this}rotateX(t){return this.rotateOnAxis(uc,t)}rotateY(t){return this.rotateOnAxis(dc,t)}rotateZ(t){return this.rotateOnAxis(fc,t)}translateOnAxis(t,e){return cc.copy(t).applyQuaternion(this.quaternion),this.position.add(cc.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(uc,t)}translateY(t){return this.translateOnAxis(dc,t)}translateZ(t){return this.translateOnAxis(fc,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Oi.copy(this.matrixWorld).invert())}lookAt(t,e,i){t.isVector3?Nr.copy(t):Nr.set(t,e,i);const n=this.parent;this.updateWorldMatrix(!0,!1),$s.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Oi.lookAt($s,Nr,this.up):Oi.lookAt(Nr,$s,this.up),this.quaternion.setFromRotationMatrix(Oi),n&&(Oi.extractRotation(n.matrixWorld),Qn.setFromRotationMatrix(Oi),this.quaternion.premultiply(Qn.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(Gt("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(pc),jn.child=t,this.dispatchEvent(jn),jn.child=null):Gt("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(lp),uo.child=t,this.dispatchEvent(uo),uo.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Oi.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Oi.multiply(t.parent.matrixWorld)),t.applyMatrix4(Oi),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(pc),jn.child=t,this.dispatchEvent(jn),jn.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let i=0,n=this.children.length;i<n;i++){const a=this.children[i].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,i=[]){this[t]===e&&i.push(this);const n=this.children;for(let r=0,a=n.length;r<a;r++)n[r].getObjectsByProperty(t,e,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose($s,t,ap),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose($s,op,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,i=t.y,n=t.z,r=this.matrix.elements;r[12]+=e-r[0]*e-r[4]*i-r[8]*n,r[13]+=i-r[1]*e-r[5]*i-r[9]*n,r[14]+=n-r[2]*e-r[6]*i-r[10]*n}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].updateMatrixWorld(t)}updateWorldMatrix(t,e,i=!1){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),e===!0){const r=this.children;for(let a=0,o=r.length;a<o;a++)r[a].updateWorldMatrix(!1,!0,i)}}toJSON(t){const e=t===void 0||typeof t=="string",i={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const n={};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.castShadow===!0&&(n.castShadow=!0),this.receiveShadow===!0&&(n.receiveShadow=!0),this.visible===!1&&(n.visible=!1),this.frustumCulled===!1&&(n.frustumCulled=!1),this.renderOrder!==0&&(n.renderOrder=this.renderOrder),this.static!==!1&&(n.static=this.static),Object.keys(this.userData).length>0&&(n.userData=this.userData),n.layers=this.layers.mask,n.matrix=this.matrix.toArray(),n.up=this.up.toArray(),this.pivot!==null&&(n.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(n.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(n.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(n.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(n.type="InstancedMesh",n.count=this.count,n.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(n.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(n.type="BatchedMesh",n.perObjectFrustumCulled=this.perObjectFrustumCulled,n.sortObjects=this.sortObjects,n.drawRanges=this._drawRanges,n.reservedRanges=this._reservedRanges,n.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),n.instanceInfo=this._instanceInfo.map(o=>({...o})),n.availableInstanceIds=this._availableInstanceIds.slice(),n.availableGeometryIds=this._availableGeometryIds.slice(),n.nextIndexStart=this._nextIndexStart,n.nextVertexStart=this._nextVertexStart,n.geometryCount=this._geometryCount,n.maxInstanceCount=this._maxInstanceCount,n.maxVertexCount=this._maxVertexCount,n.maxIndexCount=this._maxIndexCount,n.geometryInitialized=this._geometryInitialized,n.matricesTexture=this._matricesTexture.toJSON(t),n.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(n.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(n.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(n.boundingBox=this.boundingBox.toJSON()));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?n.background=this.background.toJSON():this.background.isTexture&&(n.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(n.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){n.geometry=r(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let h=0,u=l.length;h<u;h++){const d=l[h];r(t.shapes,d)}else r(t.shapes,l)}}if(this.isSkinnedMesh&&(n.bindMode=this.bindMode,n.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),n.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(r(t.materials,this.material[l]));n.material=o}else n.material=r(t.materials,this.material);if(this.children.length>0){n.children=[];for(let o=0;o<this.children.length;o++)n.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){n.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];n.animations.push(r(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),h=a(t.textures),u=a(t.images),d=a(t.shapes),c=a(t.skeletons),f=a(t.animations),g=a(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),u.length>0&&(i.images=u),d.length>0&&(i.shapes=d),c.length>0&&(i.skeletons=c),f.length>0&&(i.animations=f),g.length>0&&(i.nodes=g)}return i.object=n,i;function a(o){const l=[];for(const h in o){const u=o[h];delete u.metadata,l.push(u)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let i=0;i<t.children.length;i++){const n=t.children[i];this.add(n.clone())}return this}};Si.DEFAULT_UP=new U(0,1,0);Si.DEFAULT_MATRIX_AUTO_UPDATE=!0;Si.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;let Ls=class extends Si{constructor(){super(),this.isGroup=!0,this.type="Group"}};const hp={type:"move"};class fo{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ls,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ls,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new U,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new U),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ls,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new U,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new U,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const i of t.hand.values())this._getHandJoint(e,i)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,i){let n=null,r=null,a=null;const o=this._targetRay,l=this._grip,h=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(h&&t.hand){a=!0;for(const _ of t.hand.values()){const m=e.getJointPose(_,i),p=this._getHandJoint(h,_);m!==null&&(p.matrix.fromArray(m.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=m.radius),p.visible=m!==null}const u=h.joints["index-finger-tip"],d=h.joints["thumb-tip"],c=u.position.distanceTo(d.position),f=.02,g=.005;h.inputState.pinching&&c>f+g?(h.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!h.inputState.pinching&&c<=f-g&&(h.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(r=e.getPose(t.gripSpace,i),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:t,target:this})));o!==null&&(n=e.getPose(t.targetRaySpace,i),n===null&&r!==null&&(n=r),n!==null&&(o.matrix.fromArray(n.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,n.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(n.linearVelocity)):o.hasLinearVelocity=!1,n.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(n.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(hp)))}return o!==null&&(o.visible=n!==null),l!==null&&(l.visible=r!==null),h!==null&&(h.visible=a!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const i=new Ls;i.matrixAutoUpdate=!1,i.visible=!1,t.joints[e.jointName]=i,t.add(i)}return t.joints[e.jointName]}}const hd={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},an={h:0,s:0,l:0},Fr={h:0,s:0,l:0};function po(s,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?s+(t-s)*6*e:e<1/2?t:e<2/3?s+(t-s)*6*(2/3-e):s}let Dt=class{constructor(t,e,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,i)}set(t,e,i){if(e===void 0&&i===void 0){const n=t;n&&n.isColor?this.copy(n):typeof n=="number"?this.setHex(n):typeof n=="string"&&this.setStyle(n)}else this.setRGB(t,e,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=je){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,kt.colorSpaceToWorking(this,e),this}setRGB(t,e,i,n=kt.workingColorSpace){return this.r=t,this.g=e,this.b=i,kt.colorSpaceToWorking(this,n),this}setHSL(t,e,i,n=kt.workingColorSpace){if(t=Eh(t,1),e=zt(e,0,1),i=zt(i,0,1),e===0)this.r=this.g=this.b=i;else{const r=i<=.5?i*(1+e):i+e-i*e,a=2*i-r;this.r=po(a,r,t+1/3),this.g=po(a,r,t),this.b=po(a,r,t-1/3)}return kt.colorSpaceToWorking(this,n),this}setStyle(t,e=je){function i(r){r!==void 0&&parseFloat(r)<1&&Rt("Color: Alpha component of "+t+" will be ignored.")}let n;if(n=/^(\w+)\(([^\)]*)\)/.exec(t)){let r;const a=n[1],o=n[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:Rt("Color: Unknown color model "+t)}}else if(n=/^\#([A-Fa-f\d]+)$/.exec(t)){const r=n[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(r,16),e);Rt("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=je){const i=hd[t.toLowerCase()];return i!==void 0?this.setHex(i,e):Rt("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=Ki(t.r),this.g=Ki(t.g),this.b=Ki(t.b),this}copyLinearToSRGB(t){return this.r=zs(t.r),this.g=zs(t.g),this.b=zs(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=je){return kt.workingToColorSpace(Ue.copy(this),t),Math.round(zt(Ue.r*255,0,255))*65536+Math.round(zt(Ue.g*255,0,255))*256+Math.round(zt(Ue.b*255,0,255))}getHexString(t=je){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=kt.workingColorSpace){kt.workingToColorSpace(Ue.copy(this),e);const i=Ue.r,n=Ue.g,r=Ue.b,a=Math.max(i,n,r),o=Math.min(i,n,r);let l,h;const u=(o+a)/2;if(o===a)l=0,h=0;else{const d=a-o;switch(h=u<=.5?d/(a+o):d/(2-a-o),a){case i:l=(n-r)/d+(n<r?6:0);break;case n:l=(r-i)/d+2;break;case r:l=(i-n)/d+4;break}l/=6}return t.h=l,t.s=h,t.l=u,t}getRGB(t,e=kt.workingColorSpace){return kt.workingToColorSpace(Ue.copy(this),e),t.r=Ue.r,t.g=Ue.g,t.b=Ue.b,t}getStyle(t=je){kt.workingToColorSpace(Ue.copy(this),t);const e=Ue.r,i=Ue.g,n=Ue.b;return t!==je?`color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${n.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(i*255)},${Math.round(n*255)})`}offsetHSL(t,e,i){return this.getHSL(an),this.setHSL(an.h+t,an.s+e,an.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,i){return this.r=t.r+(e.r-t.r)*i,this.g=t.g+(e.g-t.g)*i,this.b=t.b+(e.b-t.b)*i,this}lerpHSL(t,e){this.getHSL(an),t.getHSL(Fr);const i=xr(an.h,Fr.h,e),n=xr(an.s,Fr.s,e),r=xr(an.l,Fr.l,e);return this.setHSL(i,n,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,i=this.g,n=this.b,r=t.elements;return this.r=r[0]*e+r[3]*i+r[6]*n,this.g=r[1]*e+r[4]*i+r[7]*n,this.b=r[2]*e+r[5]*i+r[8]*n,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}};const Ue=new Dt;Dt.NAMES=hd;class Ah{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new Dt(t),this.density=e}clone(){return new Ah(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class Rh{constructor(t,e=1,i=1e3){this.isFog=!0,this.name="",this.color=new Dt(t),this.near=e,this.far=i}clone(){return new Rh(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}class Oa extends Si{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new wn,this.environmentIntensity=1,this.environmentRotation=new wn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}const ui=new U,zi=new U,mo=new U,Bi=new U,ts=new U,es=new U,mc=new U,go=new U,xo=new U,_o=new U,yo=new me,Mo=new me,vo=new me;let Zs=class Ds{constructor(t=new U,e=new U,i=new U){this.a=t,this.b=e,this.c=i}static getNormal(t,e,i,n){n.subVectors(i,e),ui.subVectors(t,e),n.cross(ui);const r=n.lengthSq();return r>0?n.multiplyScalar(1/Math.sqrt(r)):n.set(0,0,0)}static getBarycoord(t,e,i,n,r){ui.subVectors(n,e),zi.subVectors(i,e),mo.subVectors(t,e);const a=ui.dot(ui),o=ui.dot(zi),l=ui.dot(mo),h=zi.dot(zi),u=zi.dot(mo),d=a*h-o*o;if(d===0)return r.set(0,0,0),null;const c=1/d,f=(h*l-o*u)*c,g=(a*u-o*l)*c;return r.set(1-f-g,g,f)}static containsPoint(t,e,i,n){return this.getBarycoord(t,e,i,n,Bi)===null?!1:Bi.x>=0&&Bi.y>=0&&Bi.x+Bi.y<=1}static getInterpolation(t,e,i,n,r,a,o,l){return this.getBarycoord(t,e,i,n,Bi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,Bi.x),l.addScaledVector(a,Bi.y),l.addScaledVector(o,Bi.z),l)}static getInterpolatedAttribute(t,e,i,n,r,a){return yo.setScalar(0),Mo.setScalar(0),vo.setScalar(0),yo.fromBufferAttribute(t,e),Mo.fromBufferAttribute(t,i),vo.fromBufferAttribute(t,n),a.setScalar(0),a.addScaledVector(yo,r.x),a.addScaledVector(Mo,r.y),a.addScaledVector(vo,r.z),a}static isFrontFacing(t,e,i,n){return ui.subVectors(i,e),zi.subVectors(t,e),ui.cross(zi).dot(n)<0}set(t,e,i){return this.a.copy(t),this.b.copy(e),this.c.copy(i),this}setFromPointsAndIndices(t,e,i,n){return this.a.copy(t[e]),this.b.copy(t[i]),this.c.copy(t[n]),this}setFromAttributeAndIndices(t,e,i,n){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return ui.subVectors(this.c,this.b),zi.subVectors(this.a,this.b),ui.cross(zi).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Ds.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return Ds.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,i,n,r){return Ds.getInterpolation(t,this.a,this.b,this.c,e,i,n,r)}containsPoint(t){return Ds.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Ds.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const i=this.a,n=this.b,r=this.c;let a,o;ts.subVectors(n,i),es.subVectors(r,i),go.subVectors(t,i);const l=ts.dot(go),h=es.dot(go);if(l<=0&&h<=0)return e.copy(i);xo.subVectors(t,n);const u=ts.dot(xo),d=es.dot(xo);if(u>=0&&d<=u)return e.copy(n);const c=l*d-u*h;if(c<=0&&l>=0&&u<=0)return a=l/(l-u),e.copy(i).addScaledVector(ts,a);_o.subVectors(t,r);const f=ts.dot(_o),g=es.dot(_o);if(g>=0&&f<=g)return e.copy(r);const _=f*h-l*g;if(_<=0&&h>=0&&g<=0)return o=h/(h-g),e.copy(i).addScaledVector(es,o);const m=u*g-f*d;if(m<=0&&d-u>=0&&f-g>=0)return mc.subVectors(r,n),o=(d-u)/(d-u+(f-g)),e.copy(n).addScaledVector(mc,o);const p=1/(m+_+c);return a=_*p,o=c*p,e.copy(i).addScaledVector(ts,a).addScaledVector(es,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},Wn=class{constructor(t=new U(1/0,1/0,1/0),e=new U(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e+=3)this.expandByPoint(di.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,i=t.count;e<i;e++)this.expandByPoint(di.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const i=di.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const i=t.geometry;if(i!==void 0){const r=i.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,di):di.fromBufferAttribute(r,a),di.applyMatrix4(t.matrixWorld),this.expandByPoint(di);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),Ur.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Ur.copy(i.boundingBox)),Ur.applyMatrix4(t.matrixWorld),this.union(Ur)}const n=t.children;for(let r=0,a=n.length;r<a;r++)this.expandByObject(n[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,di),di.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,i;return t.normal.x>0?(e=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),e<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Ks),Or.subVectors(this.max,Ks),is.subVectors(t.a,Ks),ns.subVectors(t.b,Ks),ss.subVectors(t.c,Ks),on.subVectors(ns,is),ln.subVectors(ss,ns),Cn.subVectors(is,ss);let e=[0,-on.z,on.y,0,-ln.z,ln.y,0,-Cn.z,Cn.y,on.z,0,-on.x,ln.z,0,-ln.x,Cn.z,0,-Cn.x,-on.y,on.x,0,-ln.y,ln.x,0,-Cn.y,Cn.x,0];return!So(e,is,ns,ss,Or)||(e=[1,0,0,0,1,0,0,0,1],!So(e,is,ns,ss,Or))?!1:(zr.crossVectors(on,ln),e=[zr.x,zr.y,zr.z],So(e,is,ns,ss,Or))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,di).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(di).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(ki[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),ki[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),ki[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),ki[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),ki[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),ki[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),ki[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),ki[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(ki),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}};const ki=[new U,new U,new U,new U,new U,new U,new U,new U],di=new U,Ur=new Wn,is=new U,ns=new U,ss=new U,on=new U,ln=new U,Cn=new U,Ks=new U,Or=new U,zr=new U,Pn=new U;function So(s,t,e,i,n){for(let r=0,a=s.length-3;r<=a;r+=3){Pn.fromArray(s,r);const o=n.x*Math.abs(Pn.x)+n.y*Math.abs(Pn.y)+n.z*Math.abs(Pn.z),l=t.dot(Pn),h=e.dot(Pn),u=i.dot(Pn);if(Math.max(-Math.max(l,h,u),Math.min(l,h,u))>o)return!1}return!0}const _e=new U,Br=new Pt;let cp=0,Mi=class extends Tn{constructor(t,e,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:cp++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=i,this.usage=tc,this.updateRanges=[],this.gpuType=xi,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,i){t*=this.itemSize,i*=e.itemSize;for(let n=0,r=this.itemSize;n<r;n++)this.array[t+n]=e.array[i+n];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,i=this.count;e<i;e++)Br.fromBufferAttribute(this,e),Br.applyMatrix3(t),this.setXY(e,Br.x,Br.y);else if(this.itemSize===3)for(let e=0,i=this.count;e<i;e++)_e.fromBufferAttribute(this,e),_e.applyMatrix3(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}applyMatrix4(t){for(let e=0,i=this.count;e<i;e++)_e.fromBufferAttribute(this,e),_e.applyMatrix4(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)_e.fromBufferAttribute(this,e),_e.applyNormalMatrix(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)_e.fromBufferAttribute(this,e),_e.transformDirection(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let i=this.array[t*this.itemSize+e];return this.normalized&&(i=Ps(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=Ge(i,this.array)),this.array[t*this.itemSize+e]=i,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Ps(e,this.array)),e}setX(t,e){return this.normalized&&(e=Ge(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Ps(e,this.array)),e}setY(t,e){return this.normalized&&(e=Ge(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Ps(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Ge(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Ps(e,this.array)),e}setW(t,e){return this.normalized&&(e=Ge(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,i){return t*=this.itemSize,this.normalized&&(e=Ge(e,this.array),i=Ge(i,this.array)),this.array[t+0]=e,this.array[t+1]=i,this}setXYZ(t,e,i,n){return t*=this.itemSize,this.normalized&&(e=Ge(e,this.array),i=Ge(i,this.array),n=Ge(n,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this}setXYZW(t,e,i,n,r){return t*=this.itemSize,this.normalized&&(e=Ge(e,this.array),i=Ge(i,this.array),n=Ge(n,this.array),r=Ge(r,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==tc&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}},cd=class extends Mi{constructor(t,e,i){super(new Uint16Array(t),e,i)}},ud=class extends Mi{constructor(t,e,i){super(new Uint32Array(t),e,i)}},oi=class extends Mi{constructor(t,e,i){super(new Float32Array(t),e,i)}};const up=new Wn,Js=new U,bo=new U;let wr=class{constructor(t=new U,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const i=this.center;e!==void 0?i.copy(e):up.setFromPoints(t).getCenter(i);let n=0;for(let r=0,a=t.length;r<a;r++)n=Math.max(n,i.distanceToSquared(t[r]));return this.radius=Math.sqrt(n),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const i=this.center.distanceToSquared(t);return e.copy(t),i>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Js.subVectors(t,this.center);const e=Js.lengthSq();if(e>this.radius*this.radius){const i=Math.sqrt(e),n=(i-this.radius)*.5;this.center.addScaledVector(Js,n/i),this.radius+=n}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(bo.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Js.copy(t.center).add(bo)),this.expandByPoint(Js.copy(t.center).sub(bo))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},dp=0;const si=new oe,Eo=new Si,rs=new U,Ke=new Wn,Qs=new Wn,Ae=new U;let An=class dd extends Tn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:dp++}),this.uuid=Xs(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Df(t)?ud:cd)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,i=0){this.groups.push({start:t,count:e,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const r=new Ft().getNormalMatrix(t);i.applyNormalMatrix(r),i.needsUpdate=!0}const n=this.attributes.tangent;return n!==void 0&&(n.transformDirection(t),n.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return si.makeRotationFromQuaternion(t),this.applyMatrix4(si),this}rotateX(t){return si.makeRotationX(t),this.applyMatrix4(si),this}rotateY(t){return si.makeRotationY(t),this.applyMatrix4(si),this}rotateZ(t){return si.makeRotationZ(t),this.applyMatrix4(si),this}translate(t,e,i){return si.makeTranslation(t,e,i),this.applyMatrix4(si),this}scale(t,e,i){return si.makeScale(t,e,i),this.applyMatrix4(si),this}lookAt(t){return Eo.lookAt(t),Eo.updateMatrix(),this.applyMatrix4(Eo.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(rs).negate(),this.translate(rs.x,rs.y,rs.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const i=[];for(let n=0,r=t.length;n<r;n++){const a=t[n];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new oi(i,3))}else{const i=Math.min(t.length,e.count);for(let n=0;n<i;n++){const r=t[n];e.setXYZ(n,r.x,r.y,r.z||0)}t.length>e.count&&Rt("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Wn);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Gt("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new U(-1/0,-1/0,-1/0),new U(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let i=0,n=e.length;i<n;i++){const r=e[i];Ke.setFromBufferAttribute(r),this.morphTargetsRelative?(Ae.addVectors(this.boundingBox.min,Ke.min),this.boundingBox.expandByPoint(Ae),Ae.addVectors(this.boundingBox.max,Ke.max),this.boundingBox.expandByPoint(Ae)):(this.boundingBox.expandByPoint(Ke.min),this.boundingBox.expandByPoint(Ke.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Gt('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new wr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Gt("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new U,1/0);return}if(t){const i=this.boundingSphere.center;if(Ke.setFromBufferAttribute(t),e)for(let r=0,a=e.length;r<a;r++){const o=e[r];Qs.setFromBufferAttribute(o),this.morphTargetsRelative?(Ae.addVectors(Ke.min,Qs.min),Ke.expandByPoint(Ae),Ae.addVectors(Ke.max,Qs.max),Ke.expandByPoint(Ae)):(Ke.expandByPoint(Qs.min),Ke.expandByPoint(Qs.max))}Ke.getCenter(i);let n=0;for(let r=0,a=t.count;r<a;r++)Ae.fromBufferAttribute(t,r),n=Math.max(n,i.distanceToSquared(Ae));if(e)for(let r=0,a=e.length;r<a;r++){const o=e[r],l=this.morphTargetsRelative;for(let h=0,u=o.count;h<u;h++)Ae.fromBufferAttribute(o,h),l&&(rs.fromBufferAttribute(t,h),Ae.add(rs)),n=Math.max(n,i.distanceToSquared(Ae))}this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&Gt('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){Gt("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=e.position,n=e.normal,r=e.uv;let a=this.getAttribute("tangent");(a===void 0||a.count!==i.count)&&(a=new Mi(new Float32Array(4*i.count),4),this.setAttribute("tangent",a));const o=[],l=[];for(let x=0;x<i.count;x++)o[x]=new U,l[x]=new U;const h=new U,u=new U,d=new U,c=new Pt,f=new Pt,g=new Pt,_=new U,m=new U;function p(x,w,C){h.fromBufferAttribute(i,x),u.fromBufferAttribute(i,w),d.fromBufferAttribute(i,C),c.fromBufferAttribute(r,x),f.fromBufferAttribute(r,w),g.fromBufferAttribute(r,C),u.sub(h),d.sub(h),f.sub(c),g.sub(c);const P=1/(f.x*g.y-g.x*f.y);isFinite(P)&&(_.copy(u).multiplyScalar(g.y).addScaledVector(d,-f.y).multiplyScalar(P),m.copy(d).multiplyScalar(f.x).addScaledVector(u,-g.x).multiplyScalar(P),o[x].add(_),o[w].add(_),o[C].add(_),l[x].add(m),l[w].add(m),l[C].add(m))}let v=this.groups;v.length===0&&(v=[{start:0,count:t.count}]);for(let x=0,w=v.length;x<w;++x){const C=v[x],P=C.start,D=C.count;for(let z=P,X=P+D;z<X;z+=3)p(t.getX(z+0),t.getX(z+1),t.getX(z+2))}const E=new U,M=new U,T=new U,b=new U;function A(x){T.fromBufferAttribute(n,x),b.copy(T);const w=o[x];E.copy(w),E.sub(T.multiplyScalar(T.dot(w))).normalize(),M.crossVectors(b,w);const P=M.dot(l[x])<0?-1:1;a.setXYZW(x,E.x,E.y,E.z,P)}for(let x=0,w=v.length;x<w;++x){const C=v[x],P=C.start,D=C.count;for(let z=P,X=P+D;z<X;z+=3)A(t.getX(z+0)),A(t.getX(z+1)),A(t.getX(z+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==e.count)i=new Mi(new Float32Array(e.count*3),3),this.setAttribute("normal",i);else for(let c=0,f=i.count;c<f;c++)i.setXYZ(c,0,0,0);const n=new U,r=new U,a=new U,o=new U,l=new U,h=new U,u=new U,d=new U;if(t)for(let c=0,f=t.count;c<f;c+=3){const g=t.getX(c+0),_=t.getX(c+1),m=t.getX(c+2);n.fromBufferAttribute(e,g),r.fromBufferAttribute(e,_),a.fromBufferAttribute(e,m),u.subVectors(a,r),d.subVectors(n,r),u.cross(d),o.fromBufferAttribute(i,g),l.fromBufferAttribute(i,_),h.fromBufferAttribute(i,m),o.add(u),l.add(u),h.add(u),i.setXYZ(g,o.x,o.y,o.z),i.setXYZ(_,l.x,l.y,l.z),i.setXYZ(m,h.x,h.y,h.z)}else for(let c=0,f=e.count;c<f;c+=3)n.fromBufferAttribute(e,c+0),r.fromBufferAttribute(e,c+1),a.fromBufferAttribute(e,c+2),u.subVectors(a,r),d.subVectors(n,r),u.cross(d),i.setXYZ(c+0,u.x,u.y,u.z),i.setXYZ(c+1,u.x,u.y,u.z),i.setXYZ(c+2,u.x,u.y,u.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,i=t.count;e<i;e++)Ae.fromBufferAttribute(t,e),Ae.normalize(),t.setXYZ(e,Ae.x,Ae.y,Ae.z)}toNonIndexed(){function t(o,l){const h=o.array,u=o.itemSize,d=o.normalized,c=new h.constructor(l.length*u);let f=0,g=0;for(let _=0,m=l.length;_<m;_++){o.isInterleavedBufferAttribute?f=l[_]*o.data.stride+o.offset:f=l[_]*u;for(let p=0;p<u;p++)c[g++]=h[f++]}return new Mi(c,u,d)}if(this.index===null)return Rt("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new dd,i=this.index.array,n=this.attributes;for(const o in n){const l=n[o],h=t(l,i);e.setAttribute(o,h)}const r=this.morphAttributes;for(const o in r){const l=[],h=r[o];for(let u=0,d=h.length;u<d;u++){const c=h[u],f=t(c,i);l.push(f)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const h=a[o];e.addGroup(h.start,h.count,h.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const l=this.parameters;for(const h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const i=this.attributes;for(const l in i){const h=i[l];t.data.attributes[l]=h.toJSON(t.data)}const n={};let r=!1;for(const l in this.morphAttributes){const h=this.morphAttributes[l],u=[];for(let d=0,c=h.length;d<c;d++){const f=h[d];u.push(f.toJSON(t.data))}u.length>0&&(n[l]=u,r=!0)}r&&(t.data.morphAttributes=n,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const i=t.index;i!==null&&this.setIndex(i.clone());const n=t.attributes;for(const h in n){const u=n[h];this.setAttribute(h,u.clone(e))}const r=t.morphAttributes;for(const h in r){const u=[],d=r[h];for(let c=0,f=d.length;c<f;c++)u.push(d[c].clone(e));this.morphAttributes[h]=u}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let h=0,u=a.length;h<u;h++){const d=a[h];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}},fp=0,qs=class extends Tn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:fp++}),this.uuid=Xs(),this.name="",this.type="Material",this.blending=Us,this.side=bn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=ul,this.blendDst=dl,this.blendEquation=On,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Dt(0,0,0),this.blendAlpha=0,this.depthFunc=Vs,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=jh,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Zn,this.stencilZFail=Zn,this.stencilZPass=Zn,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const i=t[e];if(i===void 0){Rt(`Material: parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){Rt(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}n&&n.isColor?n.set(i):n&&n.isVector2&&i&&i.isVector2||n&&n.isEuler&&i&&i.isEuler||n&&n.isVector3&&i&&i.isVector3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==Us&&(i.blending=this.blending),this.side!==bn&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==ul&&(i.blendSrc=this.blendSrc),this.blendDst!==dl&&(i.blendDst=this.blendDst),this.blendEquation!==On&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==Vs&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==jh&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Zn&&(i.stencilFail=this.stencilFail),this.stencilZFail!==Zn&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==Zn&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function n(r){const a=[];for(const o in r){const l=r[o];delete l.metadata,a.push(l)}return a}if(e){const r=n(t.textures),a=n(t.images);r.length>0&&(i.textures=r),a.length>0&&(i.images=a)}return i}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new Dt().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new Pt().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Pt().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let i=null;if(e!==null){const n=e.length;i=new Array(n);for(let r=0;r!==n;++r)i[r]=e[r].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}};const Vi=new U,wo=new U,kr=new U,hn=new U,To=new U,Vr=new U,Ao=new U;let Ch=class{constructor(t=new U,e=new U(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Vi)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const i=e.dot(this.direction);return i<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=Vi.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(Vi.copy(this.origin).addScaledVector(this.direction,e),Vi.distanceToSquared(t))}distanceSqToSegment(t,e,i,n){wo.copy(t).add(e).multiplyScalar(.5),kr.copy(e).sub(t).normalize(),hn.copy(this.origin).sub(wo);const r=t.distanceTo(e)*.5,a=-this.direction.dot(kr),o=hn.dot(this.direction),l=-hn.dot(kr),h=hn.lengthSq(),u=Math.abs(1-a*a);let d,c,f,g;if(u>0)if(d=a*l-o,c=a*o-l,g=r*u,d>=0)if(c>=-g)if(c<=g){const _=1/u;d*=_,c*=_,f=d*(d+a*c+2*o)+c*(a*d+c+2*l)+h}else c=r,d=Math.max(0,-(a*c+o)),f=-d*d+c*(c+2*l)+h;else c=-r,d=Math.max(0,-(a*c+o)),f=-d*d+c*(c+2*l)+h;else c<=-g?(d=Math.max(0,-(-a*r+o)),c=d>0?-r:Math.min(Math.max(-r,-l),r),f=-d*d+c*(c+2*l)+h):c<=g?(d=0,c=Math.min(Math.max(-r,-l),r),f=c*(c+2*l)+h):(d=Math.max(0,-(a*r+o)),c=d>0?r:Math.min(Math.max(-r,-l),r),f=-d*d+c*(c+2*l)+h);else c=a>0?-r:r,d=Math.max(0,-(a*c+o)),f=-d*d+c*(c+2*l)+h;return i&&i.copy(this.origin).addScaledVector(this.direction,d),n&&n.copy(wo).addScaledVector(kr,c),f}intersectSphere(t,e){Vi.subVectors(t.center,this.origin);const i=Vi.dot(this.direction),n=Vi.dot(Vi)-i*i,r=t.radius*t.radius;if(n>r)return null;const a=Math.sqrt(r-n),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(t.normal)+t.constant)/e;return i>=0?i:null}intersectPlane(t,e){const i=this.distanceToPlane(t);return i===null?null:this.at(i,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let i,n,r,a,o,l;const h=1/this.direction.x,u=1/this.direction.y,d=1/this.direction.z,c=this.origin;return h>=0?(i=(t.min.x-c.x)*h,n=(t.max.x-c.x)*h):(i=(t.max.x-c.x)*h,n=(t.min.x-c.x)*h),u>=0?(r=(t.min.y-c.y)*u,a=(t.max.y-c.y)*u):(r=(t.max.y-c.y)*u,a=(t.min.y-c.y)*u),i>a||r>n||((r>i||isNaN(i))&&(i=r),(a<n||isNaN(n))&&(n=a),d>=0?(o=(t.min.z-c.z)*d,l=(t.max.z-c.z)*d):(o=(t.max.z-c.z)*d,l=(t.min.z-c.z)*d),i>l||o>n)||((o>i||i!==i)&&(i=o),(l<n||n!==n)&&(n=l),n<0)?null:this.at(i>=0?i:n,e)}intersectsBox(t){return this.intersectBox(t,Vi)!==null}intersectTriangle(t,e,i,n,r){To.subVectors(e,t),Vr.subVectors(i,t),Ao.crossVectors(To,Vr);let a=this.direction.dot(Ao),o;if(a>0){if(n)return null;o=1}else if(a<0)o=-1,a=-a;else return null;hn.subVectors(this.origin,t);const l=o*this.direction.dot(Vr.crossVectors(hn,Vr));if(l<0)return null;const h=o*this.direction.dot(To.cross(hn));if(h<0||l+h>a)return null;const u=-o*hn.dot(Ao);return u<0?null:this.at(u/a,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},fd=class extends qs{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Dt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new wn,this.combine=hh,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}};const gc=new oe,Dn=new Ch,Gr=new wr,xc=new U,Hr=new U,Wr=new U,Xr=new U,Ro=new U,qr=new U,_c=new U,Yr=new U;let Me=class extends Si{constructor(t=new An,e=new fd){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=n.length;r<a;r++){const o=n[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(t,e){const i=this.geometry,n=i.attributes.position,r=i.morphAttributes.position,a=i.morphTargetsRelative;e.fromBufferAttribute(n,t);const o=this.morphTargetInfluences;if(r&&o){qr.set(0,0,0);for(let l=0,h=r.length;l<h;l++){const u=o[l],d=r[l];u!==0&&(Ro.fromBufferAttribute(d,t),a?qr.addScaledVector(Ro,u):qr.addScaledVector(Ro.sub(e),u))}e.add(qr)}return e}raycast(t,e){const i=this.geometry,n=this.material,r=this.matrixWorld;n!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),Gr.copy(i.boundingSphere),Gr.applyMatrix4(r),Dn.copy(t.ray).recast(t.near),!(Gr.containsPoint(Dn.origin)===!1&&(Dn.intersectSphere(Gr,xc)===null||Dn.origin.distanceToSquared(xc)>(t.far-t.near)**2))&&(gc.copy(r).invert(),Dn.copy(t.ray).applyMatrix4(gc),!(i.boundingBox!==null&&Dn.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,e,Dn)))}_computeIntersections(t,e,i){let n;const r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,h=r.attributes.uv,u=r.attributes.uv1,d=r.attributes.normal,c=r.groups,f=r.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,_=c.length;g<_;g++){const m=c[g],p=a[m.materialIndex],v=Math.max(m.start,f.start),E=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let M=v,T=E;M<T;M+=3){const b=o.getX(M),A=o.getX(M+1),x=o.getX(M+2);n=$r(this,p,t,i,h,u,d,b,A,x),n&&(n.faceIndex=Math.floor(M/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const g=Math.max(0,f.start),_=Math.min(o.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){const v=o.getX(m),E=o.getX(m+1),M=o.getX(m+2);n=$r(this,a,t,i,h,u,d,v,E,M),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}else if(l!==void 0)if(Array.isArray(a))for(let g=0,_=c.length;g<_;g++){const m=c[g],p=a[m.materialIndex],v=Math.max(m.start,f.start),E=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let M=v,T=E;M<T;M+=3){const b=M,A=M+1,x=M+2;n=$r(this,p,t,i,h,u,d,b,A,x),n&&(n.faceIndex=Math.floor(M/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const g=Math.max(0,f.start),_=Math.min(l.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){const v=m,E=m+1,M=m+2;n=$r(this,a,t,i,h,u,d,v,E,M),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}}};function pp(s,t,e,i,n,r,a,o){let l;if(t.side===Le?l=i.intersectTriangle(a,r,n,!0,o):l=i.intersectTriangle(n,r,a,t.side===bn,o),l===null)return null;Yr.copy(o),Yr.applyMatrix4(s.matrixWorld);const h=e.ray.origin.distanceTo(Yr);return h<e.near||h>e.far?null:{distance:h,point:Yr.clone(),object:s}}function $r(s,t,e,i,n,r,a,o,l,h){s.getVertexPosition(o,Hr),s.getVertexPosition(l,Wr),s.getVertexPosition(h,Xr);const u=pp(s,t,e,i,Hr,Wr,Xr,_c);if(u){const d=new U;Zs.getBarycoord(_c,Hr,Wr,Xr,d),n&&(u.uv=Zs.getInterpolatedAttribute(n,o,l,h,d,new Pt)),r&&(u.uv1=Zs.getInterpolatedAttribute(r,o,l,h,d,new Pt)),a&&(u.normal=Zs.getInterpolatedAttribute(a,o,l,h,d,new U),u.normal.dot(i.direction)>0&&u.normal.multiplyScalar(-1));const c={a:o,b:l,c:h,normal:new U,materialIndex:0};Zs.getNormal(Hr,Wr,Xr,c.normal),u.face=c,u.barycoord=d}return u}class pd extends vi{constructor(t=null,e=1,i=1,n,r,a,o,l,h=Ie,u=Ie,d,c){super(null,a,o,l,h,u,n,r,d,c),this.isDataTexture=!0,this.image={data:t,width:e,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class yc extends Mi{constructor(t,e,i,n=1){super(t,e,i),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=n}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const as=new oe,Mc=new oe,Zr=[],vc=new Wn,mp=new oe,js=new Me,tr=new wr;class gp extends Me{constructor(t,e,i){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new yc(new Float32Array(i*16),16),this.instanceColor=null,this.morphTexture=null,this.count=i,this.boundingBox=null,this.boundingSphere=null;for(let n=0;n<i;n++)this.setMatrixAt(n,mp)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new Wn),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,as),vc.copy(t.boundingBox).applyMatrix4(as),this.boundingBox.union(vc)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new wr),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let i=0;i<e;i++)this.getMatrixAt(i,as),tr.copy(t.boundingSphere).applyMatrix4(as),this.boundingSphere.union(tr)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const i=e.morphTargetInfluences,n=this.morphTexture.source.data.data,r=i.length+1,a=t*r+1;for(let o=0;o<i.length;o++)i[o]=n[a+o]}raycast(t,e){const i=this.matrixWorld,n=this.count;if(js.geometry=this.geometry,js.material=this.material,js.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),tr.copy(this.boundingSphere),tr.applyMatrix4(i),t.ray.intersectsSphere(tr)!==!1))for(let r=0;r<n;r++){this.getMatrixAt(r,as),Mc.multiplyMatrices(i,as),js.matrixWorld=Mc,js.raycast(t,Zr);for(let a=0,o=Zr.length;a<o;a++){const l=Zr[a];l.instanceId=r,l.object=this,e.push(l)}Zr.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new yc(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){const i=e.morphTargetInfluences,n=i.length+1;this.morphTexture===null&&(this.morphTexture=new pd(new Float32Array(n*this.count),n,this.count,_h,xi));const r=this.morphTexture.source.data.data;let a=0;for(let h=0;h<i.length;h++)a+=i[h];const o=this.geometry.morphTargetsRelative?1:1-a,l=n*t;return r[l]=o,r.set(i,l+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}const Co=new U,xp=new U,_p=new Ft;class xn{constructor(t=new U(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,i,n){return this.normal.set(t,e,i),this.constant=n,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,i){const n=Co.subVectors(i,e).cross(xp.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(n,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e,i=!0){const n=t.delta(Co),r=this.normal.dot(n);if(r===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const a=-(t.start.dot(this.normal)+this.constant)/r;return i===!0&&(a<0||a>1)?null:e.copy(t.start).addScaledVector(n,a)}intersectsLine(t){const e=this.distanceToPoint(t.start),i=this.distanceToPoint(t.end);return e<0&&i>0||i<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const i=e||_p.getNormalMatrix(t),n=this.coplanarPoint(Co).applyMatrix4(t),r=this.normal.applyMatrix3(i).normalize();return this.constant=-n.dot(r),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const In=new wr,yp=new Pt(.5,.5),Kr=new U;class Ph{constructor(t=new xn,e=new xn,i=new xn,n=new xn,r=new xn,a=new xn){this.planes=[t,e,i,n,r,a]}set(t,e,i,n,r,a){const o=this.planes;return o[0].copy(t),o[1].copy(e),o[2].copy(i),o[3].copy(n),o[4].copy(r),o[5].copy(a),this}copy(t){const e=this.planes;for(let i=0;i<6;i++)e[i].copy(t.planes[i]);return this}setFromProjectionMatrix(t,e=Di,i=!1){const n=this.planes,r=t.elements,a=r[0],o=r[1],l=r[2],h=r[3],u=r[4],d=r[5],c=r[6],f=r[7],g=r[8],_=r[9],m=r[10],p=r[11],v=r[12],E=r[13],M=r[14],T=r[15];if(n[0].setComponents(h-a,f-u,p-g,T-v).normalize(),n[1].setComponents(h+a,f+u,p+g,T+v).normalize(),n[2].setComponents(h+o,f+d,p+_,T+E).normalize(),n[3].setComponents(h-o,f-d,p-_,T-E).normalize(),i)n[4].setComponents(l,c,m,M).normalize(),n[5].setComponents(h-l,f-c,p-m,T-M).normalize();else if(n[4].setComponents(h-l,f-c,p-m,T-M).normalize(),e===Di)n[5].setComponents(h+l,f+c,p+m,T+M).normalize();else if(e===vr)n[5].setComponents(l,c,m,M).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),In.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),In.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(In)}intersectsSprite(t){In.center.set(0,0,0);const e=yp.distanceTo(t.center);return In.radius=.7071067811865476+e,In.applyMatrix4(t.matrixWorld),this.intersectsSphere(In)}intersectsSphere(t){const e=this.planes,i=t.center,n=-t.radius;for(let r=0;r<6;r++)if(e[r].distanceToPoint(i)<n)return!1;return!0}intersectsBox(t){const e=this.planes;for(let i=0;i<6;i++){const n=e[i];if(Kr.x=n.normal.x>0?t.max.x:t.min.x,Kr.y=n.normal.y>0?t.max.y:t.min.y,Kr.z=n.normal.z>0?t.max.z:t.min.z,n.distanceToPoint(Kr)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let i=0;i<6;i++)if(e[i].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class md extends vi{constructor(t=[],e=Gn,i,n,r,a,o,l,h,u){super(t,e,i,n,r,a,o,l,h,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class Hs extends vi{constructor(t,e,i=Fi,n,r,a,o=Ie,l=Ie,h,u=ji,d=1){if(u!==ji&&u!==Vn)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const c={width:t,height:e,depth:d};super(c,n,r,a,o,l,u,i,h),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new wh(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}class Mp extends Hs{constructor(t,e=Fi,i=Gn,n,r,a=Ie,o=Ie,l,h=ji){const u={width:t,height:t,depth:1},d=[u,u,u,u,u,u];super(t,t,e,i,n,r,a,o,l,h),this.image=d,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}}class gd extends vi{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}}class Xn extends An{constructor(t=1,e=1,i=1,n=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:i,widthSegments:n,heightSegments:r,depthSegments:a};const o=this;n=Math.floor(n),r=Math.floor(r),a=Math.floor(a);const l=[],h=[],u=[],d=[];let c=0,f=0;g("z","y","x",-1,-1,i,e,t,a,r,0),g("z","y","x",1,-1,i,e,-t,a,r,1),g("x","z","y",1,1,t,i,e,n,a,2),g("x","z","y",1,-1,t,i,-e,n,a,3),g("x","y","z",1,-1,t,e,i,n,r,4),g("x","y","z",-1,-1,t,e,-i,n,r,5),this.setIndex(l),this.setAttribute("position",new oi(h,3)),this.setAttribute("normal",new oi(u,3)),this.setAttribute("uv",new oi(d,2));function g(_,m,p,v,E,M,T,b,A,x,w){const C=M/A,P=T/x,D=M/2,z=T/2,X=b/2,N=A+1,Y=x+1;let V=0,Q=0;const tt=new U;for(let nt=0;nt<Y;nt++){const ct=nt*P-z;for(let _t=0;_t<N;_t++){const Xt=_t*C-D;tt[_]=Xt*v,tt[m]=ct*E,tt[p]=X,h.push(tt.x,tt.y,tt.z),tt[_]=0,tt[m]=0,tt[p]=b>0?1:-1,u.push(tt.x,tt.y,tt.z),d.push(_t/A),d.push(1-nt/x),V+=1}}for(let nt=0;nt<x;nt++)for(let ct=0;ct<A;ct++){const _t=c+ct+N*nt,Xt=c+ct+N*(nt+1),le=c+(ct+1)+N*(nt+1),qt=c+(ct+1)+N*nt;l.push(_t,Xt,qt),l.push(Xt,le,qt),Q+=6}o.addGroup(f,Q,w),f+=Q,c+=V}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Xn(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}let xd=class _d extends An{constructor(t=1,e=1,i=1,n=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:i,heightSegments:n};const r=t/2,a=e/2,o=Math.floor(i),l=Math.floor(n),h=o+1,u=l+1,d=t/o,c=e/l,f=[],g=[],_=[],m=[];for(let p=0;p<u;p++){const v=p*c-a;for(let E=0;E<h;E++){const M=E*d-r;g.push(M,-v,0),_.push(0,0,1),m.push(E/o),m.push(1-p/l)}}for(let p=0;p<l;p++)for(let v=0;v<o;v++){const E=v+h*p,M=v+h*(p+1),T=v+1+h*(p+1),b=v+1+h*p;f.push(E,M,b),f.push(M,T,b)}this.setIndex(f),this.setAttribute("position",new oi(g,3)),this.setAttribute("normal",new oi(_,3)),this.setAttribute("uv",new oi(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new _d(t.width,t.height,t.widthSegments,t.heightSegments)}},vp=class yd extends An{constructor(t=1,e=32,i=16,n=0,r=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:i,phiStart:n,phiLength:r,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),i=Math.max(2,Math.floor(i));const l=Math.min(a+o,Math.PI);let h=0;const u=[],d=new U,c=new U,f=[],g=[],_=[],m=[];for(let p=0;p<=i;p++){const v=[],E=p/i,M=a+E*o,T=t*Math.cos(M),b=Math.sqrt(t*t-T*T);let A=0;p===0&&a===0?A=.5/e:p===i&&l===Math.PI&&(A=-.5/e);for(let x=0;x<=e;x++){const w=x/e,C=n+w*r;d.x=-b*Math.cos(C),d.y=T,d.z=b*Math.sin(C),g.push(d.x,d.y,d.z),c.copy(d).normalize(),_.push(c.x,c.y,c.z),m.push(w+A,1-E),v.push(h++)}u.push(v)}for(let p=0;p<i;p++)for(let v=0;v<e;v++){const E=u[p][v+1],M=u[p][v],T=u[p+1][v],b=u[p+1][v+1];(p!==0||a>0)&&f.push(E,M,b),(p!==i-1||l<Math.PI)&&f.push(M,T,b)}this.setIndex(f),this.setAttribute("position",new oi(g,3)),this.setAttribute("normal",new oi(_,3)),this.setAttribute("uv",new oi(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new yd(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}};function Ws(s){const t={};for(const e in s){t[e]={};for(const i in s[e]){const n=s[e][i];if(Sc(n))n.isRenderTargetTexture?(Rt("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][i]=null):t[e][i]=n.clone();else if(Array.isArray(n))if(Sc(n[0])){const r=[];for(let a=0,o=n.length;a<o;a++)r[a]=n[a].clone();t[e][i]=r}else t[e][i]=n.slice();else t[e][i]=n}}return t}function He(s){const t={};for(let e=0;e<s.length;e++){const i=Ws(s[e]);for(const n in i)t[n]=i[n]}return t}function Sc(s){return s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)}function Sp(s){const t=[];for(let e=0;e<s.length;e++)t.push(s[e].clone());return t}function Md(s){const t=s.getRenderTarget();return t===null?s.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:kt.workingColorSpace}const vd={clone:Ws,merge:He};var bp=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Ep=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;let hi=class extends qs{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=bp,this.fragmentShader=Ep,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Ws(t.uniforms),this.uniformsGroups=Sp(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const n in this.uniforms){const a=this.uniforms[n].value;a&&a.isTexture?e.uniforms[n]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[n]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[n]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[n]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[n]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[n]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[n]={type:"m4",value:a.toArray()}:e.uniforms[n]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const i={};for(const n in this.extensions)this.extensions[n]===!0&&(i[n]=!0);return Object.keys(i).length>0&&(e.extensions=i),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const i in t.uniforms){const n=t.uniforms[i];switch(this.uniforms[i]={},n.type){case"t":this.uniforms[i].value=e[n.value]||null;break;case"c":this.uniforms[i].value=new Dt().setHex(n.value);break;case"v2":this.uniforms[i].value=new Pt().fromArray(n.value);break;case"v3":this.uniforms[i].value=new U().fromArray(n.value);break;case"v4":this.uniforms[i].value=new me().fromArray(n.value);break;case"m3":this.uniforms[i].value=new Ft().fromArray(n.value);break;case"m4":this.uniforms[i].value=new oe().fromArray(n.value);break;default:this.uniforms[i].value=n.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}};class wp extends hi{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}}class bc extends qs{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Dt(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Dt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Ha,this.normalScale=new Pt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new wn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class Tp extends qs{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new Dt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Dt(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Ha,this.normalScale=new Pt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new wn,this.combine=hh,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.envMapIntensity=t.envMapIntensity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class Ap extends qs{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=bf,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class Rp extends qs{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}class Cp extends Si{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Dt(t),this.intensity=e}dispose(){this.dispatchEvent({type:"dispose"})}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,e}}const Po=new oe,Ec=new U,wc=new U;class Pp{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Pt(512,512),this.mapType=ei,this.map=null,this.mapPass=null,this.matrix=new oe,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ph,this._frameExtents=new Pt(1,1),this._viewportCount=1,this._viewports=[new me(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,i=this.matrix;Ec.setFromMatrixPosition(t.matrixWorld),e.position.copy(Ec),wc.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(wc),e.updateMatrixWorld(),Po.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Po,e.coordinateSystem,e.reversedDepth),e.coordinateSystem===vr||e.reversedDepth?i.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):i.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),i.multiply(Po)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this.biasNode=t.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}const Jr=new U,Qr=new En,Ti=new U;class Sd extends Si{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new oe,this.projectionMatrix=new oe,this.projectionMatrixInverse=new oe,this.coordinateSystem=Di,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(Jr,Qr,Ti),Ti.x===1&&Ti.y===1&&Ti.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Jr,Qr,Ti.set(1,1,1)).invert()}updateWorldMatrix(t,e,i=!1){super.updateWorldMatrix(t,e,i),this.matrixWorld.decompose(Jr,Qr,Ti),Ti.x===1&&Ti.y===1&&Ti.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Jr,Qr,Ti.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}}const cn=new U,Tc=new Pt,Ac=new Pt;class ti extends Sd{constructor(t=50,e=1,i=.1,n=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=i,this.far=n,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=Sr*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(gr*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return Sr*2*Math.atan(Math.tan(gr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,i){cn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(cn.x,cn.y).multiplyScalar(-t/cn.z),cn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(cn.x,cn.y).multiplyScalar(-t/cn.z)}getViewSize(t,e){return this.getViewBounds(t,Tc,Ac),e.subVectors(Ac,Tc)}setViewOffset(t,e,i,n,r,a){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(gr*.5*this.fov)/this.zoom,i=2*e,n=this.aspect*i,r=-.5*n;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,h=a.fullHeight;r+=a.offsetX*n/l,e-=a.offsetY*i/h,n*=a.width/l,i*=a.height/h}const o=this.filmOffset;o!==0&&(r+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+n,e,e-i,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}class Dp extends Pp{constructor(){super(new ti(90,1,.5,500)),this.isPointLightShadow=!0}}class Ip extends Cp{constructor(t,e,i=0,n=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=i,this.decay=n,this.shadow=new Dp}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}toJSON(t){const e=super.toJSON(t);return e.object.distance=this.distance,e.object.decay=this.decay,e.object.shadow=this.shadow.toJSON(),e}}class Dh extends Sd{constructor(t=-1,e=1,i=1,n=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=i,this.bottom=n,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,i,n,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=i,this.view.offsetY=n,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,n=(this.top+this.bottom)/2;let r=i-t,a=i+t,o=n+e,l=n-e;if(this.view!==null&&this.view.enabled){const h=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=h*this.view.offsetX,a=r+h*this.view.width,o-=u*this.view.offsetY,l=o-u*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}const os=-90,ls=1;class Lp extends Si{constructor(t,e,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;const n=new ti(os,ls,t,e);n.layers=this.layers,this.add(n);const r=new ti(os,ls,t,e);r.layers=this.layers,this.add(r);const a=new ti(os,ls,t,e);a.layers=this.layers,this.add(a);const o=new ti(os,ls,t,e);o.layers=this.layers,this.add(o);const l=new ti(os,ls,t,e);l.layers=this.layers,this.add(l);const h=new ti(os,ls,t,e);h.layers=this.layers,this.add(h)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[i,n,r,a,o,l]=e;for(const h of e)this.remove(h);if(t===Di)i.up.set(0,1,0),i.lookAt(1,0,0),n.up.set(0,1,0),n.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===vr)i.up.set(0,-1,0),i.lookAt(-1,0,0),n.up.set(0,-1,0),n.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const h of e)this.add(h),h.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:i,activeMipmapLevel:n}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[r,a,o,l,h,u]=this.children,d=t.getRenderTarget(),c=t.getActiveCubeFace(),f=t.getActiveMipmapLevel(),g=t.xr.enabled;t.xr.enabled=!1;const _=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let m=!1;t.isWebGLRenderer===!0?m=t.state.buffers.depth.getReversed():m=t.reversedDepthBuffer,t.setRenderTarget(i,0,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,r),t.setRenderTarget(i,1,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,a),t.setRenderTarget(i,2,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,o),t.setRenderTarget(i,3,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,l),t.setRenderTarget(i,4,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,h),i.texture.generateMipmaps=_,t.setRenderTarget(i,5,n),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,u),t.setRenderTarget(d,c,f),t.xr.enabled=g,i.texture.needsPMREMUpdate=!0}}class Np extends ti{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}}const Rc=new oe;class Fp{constructor(t,e,i=0,n=1/0){this.ray=new Ch(t,e),this.near=i,this.far=n,this.camera=null,this.layers=new Th,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,e.projectionMatrix.elements[14]).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):Gt("Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return Rc.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Rc),this}intersectObject(t,e=!0,i=[]){return th(t,this,i,e),i.sort(Cc),i}intersectObjects(t,e=!0,i=[]){for(let n=0,r=t.length;n<r;n++)th(t[n],this,i,e);return i.sort(Cc),i}}function Cc(s,t){return s.distance-t.distance}function th(s,t,e,i){let n=!0;if(s.layers.test(t.layers)&&s.raycast(t,e)===!1&&(n=!1),n===!0&&i===!0){const r=s.children;for(let a=0,o=r.length;a<o;a++)th(r[a],t,e,!0)}}class Up{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1,Rt("Clock: This module has been deprecated. Please use THREE.Timer instead.")}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const e=performance.now();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}}class Pc{constructor(t=1,e=0,i=0){this.radius=t,this.phi=e,this.theta=i}set(t,e,i){return this.radius=t,this.phi=e,this.theta=i,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=zt(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,i){return this.radius=Math.sqrt(t*t+e*e+i*i),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,i),this.phi=Math.acos(zt(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}let CM=class bd{static{bd.prototype.isMatrix2=!0}constructor(t,e,i,n){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,i,n)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let i=0;i<4;i++)this.elements[i]=t[i+e];return this}set(t,e,i,n){const r=this.elements;return r[0]=t,r[2]=e,r[1]=i,r[3]=n,this}};class Ed extends Tn{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(t){if(t===void 0){Rt("Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=t}disconnect(){}dispose(){}update(){}}function Dc(s,t,e,i){const n=Op(i);switch(e){case td:return s*t;case _h:return s*t/n.components*n.byteLength;case yh:return s*t/n.components*n.byteLength;case Hn:return s*t*2/n.components*n.byteLength;case Mh:return s*t*2/n.components*n.byteLength;case ed:return s*t*3/n.components*n.byteLength;case _i:return s*t*4/n.components*n.byteLength;case vh:return s*t*4/n.components*n.byteLength;case Da:case Ia:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case La:case Na:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case bl:case wl:return Math.max(s,16)*Math.max(t,8)/4;case Sl:case El:return Math.max(s,8)*Math.max(t,8)/2;case Tl:case Al:case Cl:case Pl:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case Rl:case Va:case Dl:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case Il:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case Ll:return Math.floor((s+4)/5)*Math.floor((t+3)/4)*16;case Nl:return Math.floor((s+4)/5)*Math.floor((t+4)/5)*16;case Fl:return Math.floor((s+5)/6)*Math.floor((t+4)/5)*16;case Ul:return Math.floor((s+5)/6)*Math.floor((t+5)/6)*16;case Ol:return Math.floor((s+7)/8)*Math.floor((t+4)/5)*16;case zl:return Math.floor((s+7)/8)*Math.floor((t+5)/6)*16;case Bl:return Math.floor((s+7)/8)*Math.floor((t+7)/8)*16;case kl:return Math.floor((s+9)/10)*Math.floor((t+4)/5)*16;case Vl:return Math.floor((s+9)/10)*Math.floor((t+5)/6)*16;case Gl:return Math.floor((s+9)/10)*Math.floor((t+7)/8)*16;case Hl:return Math.floor((s+9)/10)*Math.floor((t+9)/10)*16;case Wl:return Math.floor((s+11)/12)*Math.floor((t+9)/10)*16;case Xl:return Math.floor((s+11)/12)*Math.floor((t+11)/12)*16;case ql:case Yl:case $l:return Math.ceil(s/4)*Math.ceil(t/4)*16;case Zl:case Kl:return Math.ceil(s/4)*Math.ceil(t/4)*8;case Ga:case Jl:return Math.ceil(s/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function Op(s){switch(s){case ei:case Ku:return{byteLength:1,components:1};case yr:case Ju:case Qi:return{byteLength:2,components:1};case gh:case xh:return{byteLength:2,components:4};case Fi:case mh:case xi:return{byteLength:4,components:1};case Qu:case ju:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${s}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:lh}}));typeof window<"u"&&(window.__THREE__?Rt("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=lh);/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function wd(){let s=null,t=!1,e=null,i=null;function n(r,a){e(r,a),i=s.requestAnimationFrame(n)}return{start:function(){t!==!0&&e!==null&&s!==null&&(i=s.requestAnimationFrame(n),t=!0)},stop:function(){s!==null&&s.cancelAnimationFrame(i),t=!1},setAnimationLoop:function(r){e=r},setContext:function(r){s=r}}}function zp(s){const t=new WeakMap;function e(o,l){const h=o.array,u=o.usage,d=h.byteLength,c=s.createBuffer();s.bindBuffer(l,c),s.bufferData(l,h,u),o.onUploadCallback();let f;if(h instanceof Float32Array)f=s.FLOAT;else if(typeof Float16Array<"u"&&h instanceof Float16Array)f=s.HALF_FLOAT;else if(h instanceof Uint16Array)o.isFloat16BufferAttribute?f=s.HALF_FLOAT:f=s.UNSIGNED_SHORT;else if(h instanceof Int16Array)f=s.SHORT;else if(h instanceof Uint32Array)f=s.UNSIGNED_INT;else if(h instanceof Int32Array)f=s.INT;else if(h instanceof Int8Array)f=s.BYTE;else if(h instanceof Uint8Array)f=s.UNSIGNED_BYTE;else if(h instanceof Uint8ClampedArray)f=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+h);return{buffer:c,type:f,bytesPerElement:h.BYTES_PER_ELEMENT,version:o.version,size:d}}function i(o,l,h){const u=l.array,d=l.updateRanges;if(s.bindBuffer(h,o),d.length===0)s.bufferSubData(h,0,u);else{d.sort((f,g)=>f.start-g.start);let c=0;for(let f=1;f<d.length;f++){const g=d[c],_=d[f];_.start<=g.start+g.count+1?g.count=Math.max(g.count,_.start+_.count-g.start):(++c,d[c]=_)}d.length=c+1;for(let f=0,g=d.length;f<g;f++){const _=d[f];s.bufferSubData(h,_.start*u.BYTES_PER_ELEMENT,u,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function n(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=t.get(o);l&&(s.deleteBuffer(l.buffer),t.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const u=t.get(o);(!u||u.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const h=t.get(o);if(h===void 0)t.set(o,e(o,l));else if(h.version<o.version){if(h.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(h.buffer,o,l),h.version=o.version}}return{get:n,remove:r,update:a}}var Bp=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,kp=`#ifdef USE_ALPHAHASH
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
#endif`,Vp=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Gp=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Hp=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Wp=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Xp=`#ifdef USE_AOMAP
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
#endif`,qp=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Yp=`#ifdef USE_BATCHING
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
#endif`,$p=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Zp=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Kp=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Jp=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,Qp=`#ifdef USE_IRIDESCENCE
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
#endif`,jp=`#ifdef USE_BUMPMAP
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
#endif`,tm=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,em=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,im=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,nm=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,sm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,rm=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,am=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,om=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
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
#endif`,lm=`#define PI 3.141592653589793
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
} // validated`,hm=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,cm=`vec3 transformedNormal = objectNormal;
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
#endif`,um=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,dm=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,fm=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,pm=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,mm="gl_FragColor = linearToOutputTexel( gl_FragColor );",gm=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,xm=`#ifdef USE_ENVMAP
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
#endif`,_m=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,ym=`#ifdef USE_ENVMAP
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
#endif`,Mm=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,vm=`#ifdef USE_ENVMAP
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
#endif`,Sm=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,bm=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Em=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,wm=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Tm=`#ifdef USE_GRADIENTMAP
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
}`,Am=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Rm=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Cm=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Pm=`uniform bool receiveShadow;
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
#include <lightprobes_pars_fragment>`,Dm=`#ifdef USE_ENVMAP
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
#endif`,Im=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Lm=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Nm=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Fm=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Um=`PhysicalMaterial material;
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
#endif`,Om=`uniform sampler2D dfgLUT;
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
}`,zm=`
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
#endif`,Bm=`#if defined( RE_IndirectDiffuse )
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
#endif`,km=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Vm=`#ifdef USE_LIGHT_PROBES_GRID
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
#endif`,Gm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Hm=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Wm=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Xm=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,qm=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Ym=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,$m=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Zm=`#if defined( USE_POINTS_UV )
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
#endif`,Km=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Jm=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Qm=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,jm=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,t0=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,e0=`#ifdef USE_MORPHTARGETS
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
#endif`,i0=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,n0=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,s0=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,r0=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,a0=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,o0=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,l0=`#ifdef USE_NORMALMAP
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
#endif`,h0=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,c0=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,u0=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,d0=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,f0=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,p0=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,m0=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,g0=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,x0=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,_0=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,y0=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,M0=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,v0=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,S0=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,b0=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,E0=`float getShadowMask() {
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
}`,w0=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,T0=`#ifdef USE_SKINNING
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
#endif`,A0=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,R0=`#ifdef USE_SKINNING
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
#endif`,C0=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,P0=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,D0=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,I0=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,L0=`#ifdef USE_TRANSMISSION
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
#endif`,N0=`#ifdef USE_TRANSMISSION
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
#endif`,F0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,U0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,O0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,z0=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const B0=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,k0=`uniform sampler2D t2D;
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
}`,V0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,G0=`#ifdef ENVMAP_TYPE_CUBE
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
}`,H0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,W0=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,X0=`#include <common>
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
}`,q0=`#if DEPTH_PACKING == 3200
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
}`,Y0=`#define DISTANCE
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
}`,$0=`#define DISTANCE
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
}`,Z0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,K0=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,J0=`uniform float scale;
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
}`,Q0=`uniform vec3 diffuse;
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
}`,j0=`#include <common>
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
}`,tg=`uniform vec3 diffuse;
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
}`,eg=`#define LAMBERT
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
}`,ig=`#define LAMBERT
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
}`,ng=`#define MATCAP
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
}`,sg=`#define MATCAP
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
}`,rg=`#define NORMAL
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
}`,ag=`#define NORMAL
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
}`,og=`#define PHONG
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
}`,lg=`#define PHONG
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
}`,hg=`#define STANDARD
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
}`,cg=`#define STANDARD
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
}`,ug=`#define TOON
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
}`,dg=`#define TOON
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
}`,fg=`uniform float size;
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
}`,pg=`uniform vec3 diffuse;
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
}`,mg=`#include <common>
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
}`,gg=`uniform vec3 color;
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
}`,xg=`uniform float rotation;
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
}`,_g=`uniform vec3 diffuse;
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
}`,Ut={alphahash_fragment:Bp,alphahash_pars_fragment:kp,alphamap_fragment:Vp,alphamap_pars_fragment:Gp,alphatest_fragment:Hp,alphatest_pars_fragment:Wp,aomap_fragment:Xp,aomap_pars_fragment:qp,batching_pars_vertex:Yp,batching_vertex:$p,begin_vertex:Zp,beginnormal_vertex:Kp,bsdfs:Jp,iridescence_fragment:Qp,bumpmap_pars_fragment:jp,clipping_planes_fragment:tm,clipping_planes_pars_fragment:em,clipping_planes_pars_vertex:im,clipping_planes_vertex:nm,color_fragment:sm,color_pars_fragment:rm,color_pars_vertex:am,color_vertex:om,common:lm,cube_uv_reflection_fragment:hm,defaultnormal_vertex:cm,displacementmap_pars_vertex:um,displacementmap_vertex:dm,emissivemap_fragment:fm,emissivemap_pars_fragment:pm,colorspace_fragment:mm,colorspace_pars_fragment:gm,envmap_fragment:xm,envmap_common_pars_fragment:_m,envmap_pars_fragment:ym,envmap_pars_vertex:Mm,envmap_physical_pars_fragment:Dm,envmap_vertex:vm,fog_vertex:Sm,fog_pars_vertex:bm,fog_fragment:Em,fog_pars_fragment:wm,gradientmap_pars_fragment:Tm,lightmap_pars_fragment:Am,lights_lambert_fragment:Rm,lights_lambert_pars_fragment:Cm,lights_pars_begin:Pm,lights_toon_fragment:Im,lights_toon_pars_fragment:Lm,lights_phong_fragment:Nm,lights_phong_pars_fragment:Fm,lights_physical_fragment:Um,lights_physical_pars_fragment:Om,lights_fragment_begin:zm,lights_fragment_maps:Bm,lights_fragment_end:km,lightprobes_pars_fragment:Vm,logdepthbuf_fragment:Gm,logdepthbuf_pars_fragment:Hm,logdepthbuf_pars_vertex:Wm,logdepthbuf_vertex:Xm,map_fragment:qm,map_pars_fragment:Ym,map_particle_fragment:$m,map_particle_pars_fragment:Zm,metalnessmap_fragment:Km,metalnessmap_pars_fragment:Jm,morphinstance_vertex:Qm,morphcolor_vertex:jm,morphnormal_vertex:t0,morphtarget_pars_vertex:e0,morphtarget_vertex:i0,normal_fragment_begin:n0,normal_fragment_maps:s0,normal_pars_fragment:r0,normal_pars_vertex:a0,normal_vertex:o0,normalmap_pars_fragment:l0,clearcoat_normal_fragment_begin:h0,clearcoat_normal_fragment_maps:c0,clearcoat_pars_fragment:u0,iridescence_pars_fragment:d0,opaque_fragment:f0,packing:p0,premultiplied_alpha_fragment:m0,project_vertex:g0,dithering_fragment:x0,dithering_pars_fragment:_0,roughnessmap_fragment:y0,roughnessmap_pars_fragment:M0,shadowmap_pars_fragment:v0,shadowmap_pars_vertex:S0,shadowmap_vertex:b0,shadowmask_pars_fragment:E0,skinbase_vertex:w0,skinning_pars_vertex:T0,skinning_vertex:A0,skinnormal_vertex:R0,specularmap_fragment:C0,specularmap_pars_fragment:P0,tonemapping_fragment:D0,tonemapping_pars_fragment:I0,transmission_fragment:L0,transmission_pars_fragment:N0,uv_pars_fragment:F0,uv_pars_vertex:U0,uv_vertex:O0,worldpos_vertex:z0,background_vert:B0,background_frag:k0,backgroundCube_vert:V0,backgroundCube_frag:G0,cube_vert:H0,cube_frag:W0,depth_vert:X0,depth_frag:q0,distance_vert:Y0,distance_frag:$0,equirect_vert:Z0,equirect_frag:K0,linedashed_vert:J0,linedashed_frag:Q0,meshbasic_vert:j0,meshbasic_frag:tg,meshlambert_vert:eg,meshlambert_frag:ig,meshmatcap_vert:ng,meshmatcap_frag:sg,meshnormal_vert:rg,meshnormal_frag:ag,meshphong_vert:og,meshphong_frag:lg,meshphysical_vert:hg,meshphysical_frag:cg,meshtoon_vert:ug,meshtoon_frag:dg,points_vert:fg,points_frag:pg,shadow_vert:mg,shadow_frag:gg,sprite_vert:xg,sprite_frag:_g},dt={common:{diffuse:{value:new Dt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ft},alphaMap:{value:null},alphaMapTransform:{value:new Ft},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ft}},envmap:{envMap:{value:null},envMapRotation:{value:new Ft},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ft}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ft}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ft},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ft},normalScale:{value:new Pt(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ft},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ft}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ft}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ft}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Dt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new U},probesMax:{value:new U},probesResolution:{value:new U}},points:{diffuse:{value:new Dt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ft},alphaTest:{value:0},uvTransform:{value:new Ft}},sprite:{diffuse:{value:new Dt(16777215)},opacity:{value:1},center:{value:new Pt(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ft},alphaMap:{value:null},alphaMapTransform:{value:new Ft},alphaTest:{value:0}}},Ci={basic:{uniforms:He([dt.common,dt.specularmap,dt.envmap,dt.aomap,dt.lightmap,dt.fog]),vertexShader:Ut.meshbasic_vert,fragmentShader:Ut.meshbasic_frag},lambert:{uniforms:He([dt.common,dt.specularmap,dt.envmap,dt.aomap,dt.lightmap,dt.emissivemap,dt.bumpmap,dt.normalmap,dt.displacementmap,dt.fog,dt.lights,{emissive:{value:new Dt(0)},envMapIntensity:{value:1}}]),vertexShader:Ut.meshlambert_vert,fragmentShader:Ut.meshlambert_frag},phong:{uniforms:He([dt.common,dt.specularmap,dt.envmap,dt.aomap,dt.lightmap,dt.emissivemap,dt.bumpmap,dt.normalmap,dt.displacementmap,dt.fog,dt.lights,{emissive:{value:new Dt(0)},specular:{value:new Dt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Ut.meshphong_vert,fragmentShader:Ut.meshphong_frag},standard:{uniforms:He([dt.common,dt.envmap,dt.aomap,dt.lightmap,dt.emissivemap,dt.bumpmap,dt.normalmap,dt.displacementmap,dt.roughnessmap,dt.metalnessmap,dt.fog,dt.lights,{emissive:{value:new Dt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ut.meshphysical_vert,fragmentShader:Ut.meshphysical_frag},toon:{uniforms:He([dt.common,dt.aomap,dt.lightmap,dt.emissivemap,dt.bumpmap,dt.normalmap,dt.displacementmap,dt.gradientmap,dt.fog,dt.lights,{emissive:{value:new Dt(0)}}]),vertexShader:Ut.meshtoon_vert,fragmentShader:Ut.meshtoon_frag},matcap:{uniforms:He([dt.common,dt.bumpmap,dt.normalmap,dt.displacementmap,dt.fog,{matcap:{value:null}}]),vertexShader:Ut.meshmatcap_vert,fragmentShader:Ut.meshmatcap_frag},points:{uniforms:He([dt.points,dt.fog]),vertexShader:Ut.points_vert,fragmentShader:Ut.points_frag},dashed:{uniforms:He([dt.common,dt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ut.linedashed_vert,fragmentShader:Ut.linedashed_frag},depth:{uniforms:He([dt.common,dt.displacementmap]),vertexShader:Ut.depth_vert,fragmentShader:Ut.depth_frag},normal:{uniforms:He([dt.common,dt.bumpmap,dt.normalmap,dt.displacementmap,{opacity:{value:1}}]),vertexShader:Ut.meshnormal_vert,fragmentShader:Ut.meshnormal_frag},sprite:{uniforms:He([dt.sprite,dt.fog]),vertexShader:Ut.sprite_vert,fragmentShader:Ut.sprite_frag},background:{uniforms:{uvTransform:{value:new Ft},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ut.background_vert,fragmentShader:Ut.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ft}},vertexShader:Ut.backgroundCube_vert,fragmentShader:Ut.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ut.cube_vert,fragmentShader:Ut.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ut.equirect_vert,fragmentShader:Ut.equirect_frag},distance:{uniforms:He([dt.common,dt.displacementmap,{referencePosition:{value:new U},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ut.distance_vert,fragmentShader:Ut.distance_frag},shadow:{uniforms:He([dt.lights,dt.fog,{color:{value:new Dt(0)},opacity:{value:1}}]),vertexShader:Ut.shadow_vert,fragmentShader:Ut.shadow_frag}};Ci.physical={uniforms:He([Ci.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ft},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ft},clearcoatNormalScale:{value:new Pt(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ft},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ft},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ft},sheen:{value:0},sheenColor:{value:new Dt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ft},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ft},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ft},transmissionSamplerSize:{value:new Pt},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ft},attenuationDistance:{value:0},attenuationColor:{value:new Dt(0)},specularColor:{value:new Dt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ft},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ft},anisotropyVector:{value:new Pt},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ft}}]),vertexShader:Ut.meshphysical_vert,fragmentShader:Ut.meshphysical_frag};const jr={r:0,b:0,g:0},yg=new oe,Td=new Ft;Td.set(-1,0,0,0,1,0,0,0,1);function Mg(s,t,e,i,n,r){const a=new Dt(0);let o=n===!0?0:1,l,h,u=null,d=0,c=null;function f(v){let E=v.isScene===!0?v.background:null;if(E&&E.isTexture){const M=v.backgroundBlurriness>0;E=t.get(E,M)}return E}function g(v){let E=!1;const M=f(v);M===null?m(a,o):M&&M.isColor&&(m(M,1),E=!0);const T=s.xr.getEnvironmentBlendMode();T==="additive"?e.buffers.color.setClear(0,0,0,1,r):T==="alpha-blend"&&e.buffers.color.setClear(0,0,0,0,r),(s.autoClear||E)&&(e.buffers.depth.setTest(!0),e.buffers.depth.setMask(!0),e.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function _(v,E){const M=f(E);M&&(M.isCubeTexture||M.mapping===ja)?(h===void 0&&(h=new Me(new Xn(1,1,1),new hi({name:"BackgroundCubeMaterial",uniforms:Ws(Ci.backgroundCube.uniforms),vertexShader:Ci.backgroundCube.vertexShader,fragmentShader:Ci.backgroundCube.fragmentShader,side:Le,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(T,b,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),h.material.uniforms.envMap.value=M,h.material.uniforms.backgroundBlurriness.value=E.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(yg.makeRotationFromEuler(E.backgroundRotation)).transpose(),M.isCubeTexture&&M.isRenderTargetTexture===!1&&h.material.uniforms.backgroundRotation.value.premultiply(Td),h.material.toneMapped=kt.getTransfer(M.colorSpace)!==Kt,(u!==M||d!==M.version||c!==s.toneMapping)&&(h.material.needsUpdate=!0,u=M,d=M.version,c=s.toneMapping),h.layers.enableAll(),v.unshift(h,h.geometry,h.material,0,0,null)):M&&M.isTexture&&(l===void 0&&(l=new Me(new xd(2,2),new hi({name:"BackgroundMaterial",uniforms:Ws(Ci.background.uniforms),vertexShader:Ci.background.vertexShader,fragmentShader:Ci.background.fragmentShader,side:bn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=M,l.material.uniforms.backgroundIntensity.value=E.backgroundIntensity,l.material.toneMapped=kt.getTransfer(M.colorSpace)!==Kt,M.matrixAutoUpdate===!0&&M.updateMatrix(),l.material.uniforms.uvTransform.value.copy(M.matrix),(u!==M||d!==M.version||c!==s.toneMapping)&&(l.material.needsUpdate=!0,u=M,d=M.version,c=s.toneMapping),l.layers.enableAll(),v.unshift(l,l.geometry,l.material,0,0,null))}function m(v,E){v.getRGB(jr,Md(s)),e.buffers.color.setClear(jr.r,jr.g,jr.b,E,r)}function p(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(v,E=1){a.set(v),o=E,m(a,o)},getClearAlpha:function(){return o},setClearAlpha:function(v){o=v,m(a,o)},render:g,addToRenderList:_,dispose:p}}function vg(s,t){const e=s.getParameter(s.MAX_VERTEX_ATTRIBS),i={},n=c(null);let r=n,a=!1;function o(P,D,z,X,N){let Y=!1;const V=d(P,X,z,D);r!==V&&(r=V,h(r.object)),Y=f(P,X,z,N),Y&&g(P,X,z,N),N!==null&&t.update(N,s.ELEMENT_ARRAY_BUFFER),(Y||a)&&(a=!1,M(P,D,z,X),N!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,t.get(N).buffer))}function l(){return s.createVertexArray()}function h(P){return s.bindVertexArray(P)}function u(P){return s.deleteVertexArray(P)}function d(P,D,z,X){const N=X.wireframe===!0;let Y=i[D.id];Y===void 0&&(Y={},i[D.id]=Y);const V=P.isInstancedMesh===!0?P.id:0;let Q=Y[V];Q===void 0&&(Q={},Y[V]=Q);let tt=Q[z.id];tt===void 0&&(tt={},Q[z.id]=tt);let nt=tt[N];return nt===void 0&&(nt=c(l()),tt[N]=nt),nt}function c(P){const D=[],z=[],X=[];for(let N=0;N<e;N++)D[N]=0,z[N]=0,X[N]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:D,enabledAttributes:z,attributeDivisors:X,object:P,attributes:{},index:null}}function f(P,D,z,X){const N=r.attributes,Y=D.attributes;let V=0;const Q=z.getAttributes();for(const tt in Q)if(Q[tt].location>=0){const ct=N[tt];let _t=Y[tt];if(_t===void 0&&(tt==="instanceMatrix"&&P.instanceMatrix&&(_t=P.instanceMatrix),tt==="instanceColor"&&P.instanceColor&&(_t=P.instanceColor)),ct===void 0||ct.attribute!==_t||_t&&ct.data!==_t.data)return!0;V++}return r.attributesNum!==V||r.index!==X}function g(P,D,z,X){const N={},Y=D.attributes;let V=0;const Q=z.getAttributes();for(const tt in Q)if(Q[tt].location>=0){let ct=Y[tt];ct===void 0&&(tt==="instanceMatrix"&&P.instanceMatrix&&(ct=P.instanceMatrix),tt==="instanceColor"&&P.instanceColor&&(ct=P.instanceColor));const _t={};_t.attribute=ct,ct&&ct.data&&(_t.data=ct.data),N[tt]=_t,V++}r.attributes=N,r.attributesNum=V,r.index=X}function _(){const P=r.newAttributes;for(let D=0,z=P.length;D<z;D++)P[D]=0}function m(P){p(P,0)}function p(P,D){const z=r.newAttributes,X=r.enabledAttributes,N=r.attributeDivisors;z[P]=1,X[P]===0&&(s.enableVertexAttribArray(P),X[P]=1),N[P]!==D&&(s.vertexAttribDivisor(P,D),N[P]=D)}function v(){const P=r.newAttributes,D=r.enabledAttributes;for(let z=0,X=D.length;z<X;z++)D[z]!==P[z]&&(s.disableVertexAttribArray(z),D[z]=0)}function E(P,D,z,X,N,Y,V){V===!0?s.vertexAttribIPointer(P,D,z,N,Y):s.vertexAttribPointer(P,D,z,X,N,Y)}function M(P,D,z,X){_();const N=X.attributes,Y=z.getAttributes(),V=D.defaultAttributeValues;for(const Q in Y){const tt=Y[Q];if(tt.location>=0){let nt=N[Q];if(nt===void 0&&(Q==="instanceMatrix"&&P.instanceMatrix&&(nt=P.instanceMatrix),Q==="instanceColor"&&P.instanceColor&&(nt=P.instanceColor)),nt!==void 0){const ct=nt.normalized,_t=nt.itemSize,Xt=t.get(nt);if(Xt===void 0)continue;const le=Xt.buffer,qt=Xt.type,J=Xt.bytesPerElement,rt=qt===s.INT||qt===s.UNSIGNED_INT||nt.gpuType===mh;if(nt.isInterleavedBufferAttribute){const et=nt.data,Ct=et.stride,It=nt.offset;if(et.isInstancedInterleavedBuffer){for(let Tt=0;Tt<tt.locationSize;Tt++)p(tt.location+Tt,et.meshPerAttribute);P.isInstancedMesh!==!0&&X._maxInstanceCount===void 0&&(X._maxInstanceCount=et.meshPerAttribute*et.count)}else for(let Tt=0;Tt<tt.locationSize;Tt++)m(tt.location+Tt);s.bindBuffer(s.ARRAY_BUFFER,le);for(let Tt=0;Tt<tt.locationSize;Tt++)E(tt.location+Tt,_t/tt.locationSize,qt,ct,Ct*J,(It+_t/tt.locationSize*Tt)*J,rt)}else{if(nt.isInstancedBufferAttribute){for(let et=0;et<tt.locationSize;et++)p(tt.location+et,nt.meshPerAttribute);P.isInstancedMesh!==!0&&X._maxInstanceCount===void 0&&(X._maxInstanceCount=nt.meshPerAttribute*nt.count)}else for(let et=0;et<tt.locationSize;et++)m(tt.location+et);s.bindBuffer(s.ARRAY_BUFFER,le);for(let et=0;et<tt.locationSize;et++)E(tt.location+et,_t/tt.locationSize,qt,ct,_t*J,_t/tt.locationSize*et*J,rt)}}else if(V!==void 0){const ct=V[Q];if(ct!==void 0)switch(ct.length){case 2:s.vertexAttrib2fv(tt.location,ct);break;case 3:s.vertexAttrib3fv(tt.location,ct);break;case 4:s.vertexAttrib4fv(tt.location,ct);break;default:s.vertexAttrib1fv(tt.location,ct)}}}}v()}function T(){w();for(const P in i){const D=i[P];for(const z in D){const X=D[z];for(const N in X){const Y=X[N];for(const V in Y)u(Y[V].object),delete Y[V];delete X[N]}}delete i[P]}}function b(P){if(i[P.id]===void 0)return;const D=i[P.id];for(const z in D){const X=D[z];for(const N in X){const Y=X[N];for(const V in Y)u(Y[V].object),delete Y[V];delete X[N]}}delete i[P.id]}function A(P){for(const D in i){const z=i[D];for(const X in z){const N=z[X];if(N[P.id]===void 0)continue;const Y=N[P.id];for(const V in Y)u(Y[V].object),delete Y[V];delete N[P.id]}}}function x(P){for(const D in i){const z=i[D],X=P.isInstancedMesh===!0?P.id:0,N=z[X];if(N!==void 0){for(const Y in N){const V=N[Y];for(const Q in V)u(V[Q].object),delete V[Q];delete N[Y]}delete z[X],Object.keys(z).length===0&&delete i[D]}}}function w(){C(),a=!0,r!==n&&(r=n,h(r.object))}function C(){n.geometry=null,n.program=null,n.wireframe=!1}return{setup:o,reset:w,resetDefaultState:C,dispose:T,releaseStatesOfGeometry:b,releaseStatesOfObject:x,releaseStatesOfProgram:A,initAttributes:_,enableAttribute:m,disableUnusedAttributes:v}}function Sg(s,t,e){let i;function n(l){i=l}function r(l,h){s.drawArrays(i,l,h),e.update(h,i,1)}function a(l,h,u){u!==0&&(s.drawArraysInstanced(i,l,h,u),e.update(h,i,u))}function o(l,h,u){if(u===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,h,0,u);let c=0;for(let f=0;f<u;f++)c+=h[f];e.update(c,i,1)}this.setMode=n,this.render=r,this.renderInstances=a,this.renderMultiDraw=o}function bg(s,t,e,i){let n;function r(){if(n!==void 0)return n;if(t.has("EXT_texture_filter_anisotropic")===!0){const A=t.get("EXT_texture_filter_anisotropic");n=s.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function a(A){return!(A!==_i&&i.convert(A)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(A){const x=A===Qi&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(A!==ei&&i.convert(A)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==xi&&!x)}function l(A){if(A==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let h=e.precision!==void 0?e.precision:"highp";const u=l(h);u!==h&&(Rt("WebGLRenderer:",h,"not supported, using",u,"instead."),h=u);const d=e.logarithmicDepthBuffer===!0,c=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control");e.reversedDepthBuffer===!0&&c===!1&&Rt("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");const f=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),g=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=s.getParameter(s.MAX_TEXTURE_SIZE),m=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),p=s.getParameter(s.MAX_VERTEX_ATTRIBS),v=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),E=s.getParameter(s.MAX_VARYING_VECTORS),M=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),T=s.getParameter(s.MAX_SAMPLES),b=s.getParameter(s.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:h,logarithmicDepthBuffer:d,reversedDepthBuffer:c,maxTextures:f,maxVertexTextures:g,maxTextureSize:_,maxCubemapSize:m,maxAttributes:p,maxVertexUniforms:v,maxVaryings:E,maxFragmentUniforms:M,maxSamples:T,samples:b}}function Eg(s){const t=this;let e=null,i=0,n=!1,r=!1;const a=new xn,o=new Ft,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,c){const f=d.length!==0||c||i!==0||n;return n=c,i=d.length,f},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(d,c){e=u(d,c,0)},this.setState=function(d,c,f){const g=d.clippingPlanes,_=d.clipIntersection,m=d.clipShadows,p=s.get(d);if(!n||g===null||g.length===0||r&&!m)r?u(null):h();else{const v=r?0:i,E=v*4;let M=p.clippingState||null;l.value=M,M=u(g,c,E,f);for(let T=0;T!==E;++T)M[T]=e[T];p.clippingState=M,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=v}};function h(){l.value!==e&&(l.value=e,l.needsUpdate=i>0),t.numPlanes=i,t.numIntersection=0}function u(d,c,f,g){const _=d!==null?d.length:0;let m=null;if(_!==0){if(m=l.value,g!==!0||m===null){const p=f+_*4,v=c.matrixWorldInverse;o.getNormalMatrix(v),(m===null||m.length<p)&&(m=new Float32Array(p));for(let E=0,M=f;E!==_;++E,M+=4)a.copy(d[E]).applyMatrix4(v,o),a.normal.toArray(m,M),m[M+3]=a.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=_,t.numIntersection=0,m}}const Mn=4,Ic=[.125,.215,.35,.446,.526,.582],zn=20,wg=256,er=new Dh,Lc=new Dt;let Do=null,Io=0,Lo=0,No=!1;const Tg=new U;class eh{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,e=0,i=.1,n=100,r={}){const{size:a=256,position:o=Tg}=r;Do=this._renderer.getRenderTarget(),Io=this._renderer.getActiveCubeFace(),Lo=this._renderer.getActiveMipmapLevel(),No=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);const l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,i,n,l,o),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Uc(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Fc(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(Do,Io,Lo),this._renderer.xr.enabled=No,t.scissorTest=!1,hs(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Gn||t.mapping===Gs?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),Do=this._renderer.getRenderTarget(),Io=this._renderer.getActiveCubeFace(),Lo=this._renderer.getActiveMipmapLevel(),No=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const i=e||this._allocateTargets();return this._textureToCubeUV(t,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,i={magFilter:Be,minFilter:Be,generateMipmaps:!1,type:Qi,format:_i,colorSpace:Wa,depthBuffer:!1},n=Nc(t,e,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Nc(t,e,i);const{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=Ag(r)),this._blurMaterial=Cg(r,t,e),this._ggxMaterial=Rg(r,t,e)}return n}_compileMaterial(t){const e=new Me(new An,t);this._renderer.compile(e,er)}_sceneToCubeUV(t,e,i,n,r){const l=new ti(90,1,e,i),h=[1,-1,1,1,1,1],u=[1,1,1,-1,-1,-1],d=this._renderer,c=d.autoClear,f=d.toneMapping;d.getClearColor(Lc),d.toneMapping=yi,d.autoClear=!1,d.state.buffers.depth.getReversed()&&(d.setRenderTarget(n),d.clearDepth(),d.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Me(new Xn,new fd({name:"PMREM.Background",side:Le,depthWrite:!1,depthTest:!1})));const _=this._backgroundBox,m=_.material;let p=!1;const v=t.background;v?v.isColor&&(m.color.copy(v),t.background=null,p=!0):(m.color.copy(Lc),p=!0);for(let E=0;E<6;E++){const M=E%3;M===0?(l.up.set(0,h[E],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+u[E],r.y,r.z)):M===1?(l.up.set(0,0,h[E]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+u[E],r.z)):(l.up.set(0,h[E],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+u[E]));const T=this._cubeSize;hs(n,M*T,E>2?T:0,T,T),d.setRenderTarget(n),p&&d.render(_,l),d.render(t,l)}d.toneMapping=f,d.autoClear=c,t.background=v}_textureToCubeUV(t,e){const i=this._renderer,n=t.mapping===Gn||t.mapping===Gs;n?(this._cubemapMaterial===null&&(this._cubemapMaterial=Uc()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Fc());const r=n?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=r;const o=r.uniforms;o.envMap.value=t;const l=this._cubeSize;hs(e,0,0,3*l,2*l),i.setRenderTarget(e),i.render(a,er)}_applyPMREM(t){const e=this._renderer,i=e.autoClear;e.autoClear=!1;const n=this._lodMeshes.length;for(let r=1;r<n;r++)this._applyGGXFilter(t,r-1,r);e.autoClear=i}_applyGGXFilter(t,e,i){const n=this._renderer,r=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[i];o.material=a;const l=a.uniforms,h=i/(this._lodMeshes.length-1),u=e/(this._lodMeshes.length-1),d=Math.sqrt(h*h-u*u),c=0+h*1.25,f=d*c,{_lodMax:g}=this,_=this._sizeLods[i],m=3*_*(i>g-Mn?i-g+Mn:0),p=4*(this._cubeSize-_);l.envMap.value=t.texture,l.roughness.value=f,l.mipInt.value=g-e,hs(r,m,p,3*_,2*_),n.setRenderTarget(r),n.render(o,er),l.envMap.value=r.texture,l.roughness.value=0,l.mipInt.value=g-i,hs(t,m,p,3*_,2*_),n.setRenderTarget(t),n.render(o,er)}_blur(t,e,i,n,r){const a=this._pingPongRenderTarget;this._halfBlur(t,a,e,i,n,"latitudinal",r),this._halfBlur(a,t,i,i,n,"longitudinal",r)}_halfBlur(t,e,i,n,r,a,o){const l=this._renderer,h=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&Gt("blur direction must be either latitudinal or longitudinal!");const u=3,d=this._lodMeshes[n];d.material=h;const c=h.uniforms,f=this._sizeLods[i]-1,g=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*zn-1),_=r/g,m=isFinite(r)?1+Math.floor(u*_):zn;m>zn&&Rt(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${zn}`);const p=[];let v=0;for(let A=0;A<zn;++A){const x=A/_,w=Math.exp(-x*x/2);p.push(w),A===0?v+=w:A<m&&(v+=2*w)}for(let A=0;A<p.length;A++)p[A]=p[A]/v;c.envMap.value=t.texture,c.samples.value=m,c.weights.value=p,c.latitudinal.value=a==="latitudinal",o&&(c.poleAxis.value=o);const{_lodMax:E}=this;c.dTheta.value=g,c.mipInt.value=E-i;const M=this._sizeLods[n],T=3*M*(n>E-Mn?n-E+Mn:0),b=4*(this._cubeSize-M);hs(e,T,b,3*M,2*M),l.setRenderTarget(e),l.render(d,er)}}function Ag(s){const t=[],e=[],i=[];let n=s;const r=s-Mn+1+Ic.length;for(let a=0;a<r;a++){const o=Math.pow(2,n);t.push(o);let l=1/o;a>s-Mn?l=Ic[a-s+Mn-1]:a===0&&(l=0),e.push(l);const h=1/(o-2),u=-h,d=1+h,c=[u,u,d,u,d,d,u,u,d,d,u,d],f=6,g=6,_=3,m=2,p=1,v=new Float32Array(_*g*f),E=new Float32Array(m*g*f),M=new Float32Array(p*g*f);for(let b=0;b<f;b++){const A=b%3*2/3-1,x=b>2?0:-1,w=[A,x,0,A+2/3,x,0,A+2/3,x+1,0,A,x,0,A+2/3,x+1,0,A,x+1,0];v.set(w,_*g*b),E.set(c,m*g*b);const C=[b,b,b,b,b,b];M.set(C,p*g*b)}const T=new An;T.setAttribute("position",new Mi(v,_)),T.setAttribute("uv",new Mi(E,m)),T.setAttribute("faceIndex",new Mi(M,p)),i.push(new Me(T,null)),n>Mn&&n--}return{lodMeshes:i,sizeLods:t,sigmas:e}}function Nc(s,t,e){const i=new Li(s,t,e);return i.texture.mapping=ja,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function hs(s,t,e,i,n){s.viewport.set(t,e,i,n),s.scissor.set(t,e,i,n)}function Rg(s,t,e){return new hi({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:wg,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:to(),fragmentShader:`

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
		`,blending:Zi,depthTest:!1,depthWrite:!1})}function Cg(s,t,e){const i=new Float32Array(zn),n=new U(0,1,0);return new hi({name:"SphericalGaussianBlur",defines:{n:zn,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:i},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:n}},vertexShader:to(),fragmentShader:`

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
		`,blending:Zi,depthTest:!1,depthWrite:!1})}function Fc(){return new hi({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:to(),fragmentShader:`

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
		`,blending:Zi,depthTest:!1,depthWrite:!1})}function Uc(){return new hi({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:to(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Zi,depthTest:!1,depthWrite:!1})}function to(){return`

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
	`}class Ad extends Li{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const i={width:t,height:t,depth:1},n=[i,i,i,i,i,i];this.texture=new md(n),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const i={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},n=new Xn(5,5,5),r=new hi({name:"CubemapFromEquirect",uniforms:Ws(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Le,blending:Zi});r.uniforms.tEquirect.value=e;const a=new Me(n,r),o=e.minFilter;return e.minFilter===kn&&(e.minFilter=Be),new Lp(1,10,this).update(t,a),e.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(t,e=!0,i=!0,n=!0){const r=t.getRenderTarget();for(let a=0;a<6;a++)t.setRenderTarget(this,a),t.clear(e,i,n);t.setRenderTarget(r)}}function Pg(s){let t=new WeakMap,e=new WeakMap,i=null;function n(c,f=!1){return c==null?null:f?a(c):r(c)}function r(c){if(c&&c.isTexture){const f=c.mapping;if(f===mr||f===ro)if(t.has(c)){const g=t.get(c).texture;return o(g,c.mapping)}else{const g=c.image;if(g&&g.height>0){const _=new Ad(g.height);return _.fromEquirectangularTexture(s,c),t.set(c,_),c.addEventListener("dispose",h),o(_.texture,c.mapping)}else return null}}return c}function a(c){if(c&&c.isTexture){const f=c.mapping,g=f===mr||f===ro,_=f===Gn||f===Gs;if(g||_){let m=e.get(c);const p=m!==void 0?m.texture.pmremVersion:0;if(c.isRenderTargetTexture&&c.pmremVersion!==p)return i===null&&(i=new eh(s)),m=g?i.fromEquirectangular(c,m):i.fromCubemap(c,m),m.texture.pmremVersion=c.pmremVersion,e.set(c,m),m.texture;if(m!==void 0)return m.texture;{const v=c.image;return g&&v&&v.height>0||_&&v&&l(v)?(i===null&&(i=new eh(s)),m=g?i.fromEquirectangular(c):i.fromCubemap(c),m.texture.pmremVersion=c.pmremVersion,e.set(c,m),c.addEventListener("dispose",u),m.texture):null}}}return c}function o(c,f){return f===mr?c.mapping=Gn:f===ro&&(c.mapping=Gs),c}function l(c){let f=0;const g=6;for(let _=0;_<g;_++)c[_]!==void 0&&f++;return f===g}function h(c){const f=c.target;f.removeEventListener("dispose",h);const g=t.get(f);g!==void 0&&(t.delete(f),g.dispose())}function u(c){const f=c.target;f.removeEventListener("dispose",u);const g=e.get(f);g!==void 0&&(e.delete(f),g.dispose())}function d(){t=new WeakMap,e=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:n,dispose:d}}function Dg(s){const t={};function e(i){if(t[i]!==void 0)return t[i];const n=s.getExtension(i);return t[i]=n,n}return{has:function(i){return e(i)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(i){const n=e(i);return n===null&&Os("WebGLRenderer: "+i+" extension not supported."),n}}}function Ig(s,t,e,i){const n={},r=new WeakMap;function a(d){const c=d.target;c.index!==null&&t.remove(c.index);for(const g in c.attributes)t.remove(c.attributes[g]);c.removeEventListener("dispose",a),delete n[c.id];const f=r.get(c);f&&(t.remove(f),r.delete(c)),i.releaseStatesOfGeometry(c),c.isInstancedBufferGeometry===!0&&delete c._maxInstanceCount,e.memory.geometries--}function o(d,c){return n[c.id]===!0||(c.addEventListener("dispose",a),n[c.id]=!0,e.memory.geometries++),c}function l(d){const c=d.attributes;for(const f in c)t.update(c[f],s.ARRAY_BUFFER)}function h(d){const c=[],f=d.index,g=d.attributes.position;let _=0;if(g===void 0)return;if(f!==null){const v=f.array;_=f.version;for(let E=0,M=v.length;E<M;E+=3){const T=v[E+0],b=v[E+1],A=v[E+2];c.push(T,b,b,A,A,T)}}else{const v=g.array;_=g.version;for(let E=0,M=v.length/3-1;E<M;E+=3){const T=E+0,b=E+1,A=E+2;c.push(T,b,b,A,A,T)}}const m=new(g.count>=65535?ud:cd)(c,1);m.version=_;const p=r.get(d);p&&t.remove(p),r.set(d,m)}function u(d){const c=r.get(d);if(c){const f=d.index;f!==null&&c.version<f.version&&h(d)}else h(d);return r.get(d)}return{get:o,update:l,getWireframeAttribute:u}}function Lg(s,t,e){let i;function n(d){i=d}let r,a;function o(d){r=d.type,a=d.bytesPerElement}function l(d,c){s.drawElements(i,c,r,d*a),e.update(c,i,1)}function h(d,c,f){f!==0&&(s.drawElementsInstanced(i,c,r,d*a,f),e.update(c,i,f))}function u(d,c,f){if(f===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,c,0,r,d,0,f);let _=0;for(let m=0;m<f;m++)_+=c[m];e.update(_,i,1)}this.setMode=n,this.setIndex=o,this.render=l,this.renderInstances=h,this.renderMultiDraw=u}function Ng(s){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function i(r,a,o){switch(e.calls++,a){case s.TRIANGLES:e.triangles+=o*(r/3);break;case s.LINES:e.lines+=o*(r/2);break;case s.LINE_STRIP:e.lines+=o*(r-1);break;case s.LINE_LOOP:e.lines+=o*r;break;case s.POINTS:e.points+=o*r;break;default:Gt("WebGLInfo: Unknown draw mode:",a);break}}function n(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:n,update:i}}function Fg(s,t,e){const i=new WeakMap,n=new me;function r(a,o,l){const h=a.morphTargetInfluences,u=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,d=u!==void 0?u.length:0;let c=i.get(o);if(c===void 0||c.count!==d){let C=function(){x.dispose(),i.delete(o),o.removeEventListener("dispose",C)};var f=C;c!==void 0&&c.texture.dispose();const g=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,m=o.morphAttributes.color!==void 0,p=o.morphAttributes.position||[],v=o.morphAttributes.normal||[],E=o.morphAttributes.color||[];let M=0;g===!0&&(M=1),_===!0&&(M=2),m===!0&&(M=3);let T=o.attributes.position.count*M,b=1;T>t.maxTextureSize&&(b=Math.ceil(T/t.maxTextureSize),T=t.maxTextureSize);const A=new Float32Array(T*b*4*d),x=new od(A,T,b,d);x.type=xi,x.needsUpdate=!0;const w=M*4;for(let P=0;P<d;P++){const D=p[P],z=v[P],X=E[P],N=T*b*4*P;for(let Y=0;Y<D.count;Y++){const V=Y*w;g===!0&&(n.fromBufferAttribute(D,Y),A[N+V+0]=n.x,A[N+V+1]=n.y,A[N+V+2]=n.z,A[N+V+3]=0),_===!0&&(n.fromBufferAttribute(z,Y),A[N+V+4]=n.x,A[N+V+5]=n.y,A[N+V+6]=n.z,A[N+V+7]=0),m===!0&&(n.fromBufferAttribute(X,Y),A[N+V+8]=n.x,A[N+V+9]=n.y,A[N+V+10]=n.z,A[N+V+11]=X.itemSize===4?n.w:1)}}c={count:d,texture:x,size:new Pt(T,b)},i.set(o,c),o.addEventListener("dispose",C)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(s,"morphTexture",a.morphTexture,e);else{let g=0;for(let m=0;m<h.length;m++)g+=h[m];const _=o.morphTargetsRelative?1:1-g;l.getUniforms().setValue(s,"morphTargetBaseInfluence",_),l.getUniforms().setValue(s,"morphTargetInfluences",h)}l.getUniforms().setValue(s,"morphTargetsTexture",c.texture,e),l.getUniforms().setValue(s,"morphTargetsTextureSize",c.size)}return{update:r}}function Ug(s,t,e,i,n){let r=new WeakMap;function a(h){const u=n.render.frame,d=h.geometry,c=t.get(h,d);if(r.get(c)!==u&&(t.update(c),r.set(c,u)),h.isInstancedMesh&&(h.hasEventListener("dispose",l)===!1&&h.addEventListener("dispose",l),r.get(h)!==u&&(e.update(h.instanceMatrix,s.ARRAY_BUFFER),h.instanceColor!==null&&e.update(h.instanceColor,s.ARRAY_BUFFER),r.set(h,u))),h.isSkinnedMesh){const f=h.skeleton;r.get(f)!==u&&(f.update(),r.set(f,u))}return c}function o(){r=new WeakMap}function l(h){const u=h.target;u.removeEventListener("dispose",l),i.releaseStatesOfObject(u),e.remove(u.instanceMatrix),u.instanceColor!==null&&e.remove(u.instanceColor)}return{update:a,dispose:o}}const Og={[ch]:"LINEAR_TONE_MAPPING",[uh]:"REINHARD_TONE_MAPPING",[dh]:"CINEON_TONE_MAPPING",[fh]:"ACES_FILMIC_TONE_MAPPING",[ph]:"AGX_TONE_MAPPING",[Qa]:"NEUTRAL_TONE_MAPPING",[$u]:"CUSTOM_TONE_MAPPING"};function zg(s,t,e,i,n,r){const a=new Li(t,e,{type:s,depthBuffer:n,stencilBuffer:r,samples:i?4:0,depthTexture:n?new Hs(t,e):void 0}),o=new Li(t,e,{type:Qi,depthBuffer:!1,stencilBuffer:!1}),l=new An;l.setAttribute("position",new oi([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute("uv",new oi([0,2,0,0,2,0],2));const h=new wp({uniforms:{tDiffuse:{value:null}},vertexShader:`
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
			}`,depthTest:!1,depthWrite:!1}),u=new Me(l,h),d=new Dh(-1,1,1,-1,0,1);let c=null,f=null,g=!1,_,m=null,p=[],v=!1;this.setSize=function(E,M){a.setSize(E,M),o.setSize(E,M);for(let T=0;T<p.length;T++){const b=p[T];b.setSize&&b.setSize(E,M)}},this.setEffects=function(E){p=E,v=p.length>0&&p[0].isRenderPass===!0;const M=a.width,T=a.height;for(let b=0;b<p.length;b++){const A=p[b];A.setSize&&A.setSize(M,T)}},this.begin=function(E,M){if(g||E.toneMapping===yi&&p.length===0)return!1;if(m=M,M!==null){const T=M.width,b=M.height;(a.width!==T||a.height!==b)&&this.setSize(T,b)}return v===!1&&E.setRenderTarget(a),_=E.toneMapping,E.toneMapping=yi,!0},this.hasRenderPass=function(){return v},this.end=function(E,M){E.toneMapping=_,g=!0;let T=a,b=o;for(let A=0;A<p.length;A++){const x=p[A];if(x.enabled!==!1&&(x.render(E,b,T,M),x.needsSwap!==!1)){const w=T;T=b,b=w}}if(c!==E.outputColorSpace||f!==E.toneMapping){c=E.outputColorSpace,f=E.toneMapping,h.defines={},kt.getTransfer(c)===Kt&&(h.defines.SRGB_TRANSFER="");const A=Og[f];A&&(h.defines[A]=""),h.needsUpdate=!0}h.uniforms.tDiffuse.value=T.texture,E.setRenderTarget(m),E.render(u,d),m=null,g=!1},this.isCompositing=function(){return g},this.dispose=function(){a.depthTexture&&a.depthTexture.dispose(),a.dispose(),o.dispose(),l.dispose(),h.dispose()}}const Rd=new vi,ih=new Hs(1,1),Cd=new od,Pd=new ip,Dd=new md,Oc=[],zc=[],Bc=new Float32Array(16),kc=new Float32Array(9),Vc=new Float32Array(4);function Ys(s,t,e){const i=s[0];if(i<=0||i>0)return s;const n=t*e;let r=Oc[n];if(r===void 0&&(r=new Float32Array(n),Oc[n]=r),t!==0){i.toArray(r,0);for(let a=1,o=0;a!==t;++a)o+=e,s[a].toArray(r,o)}return r}function Ee(s,t){if(s.length!==t.length)return!1;for(let e=0,i=s.length;e<i;e++)if(s[e]!==t[e])return!1;return!0}function we(s,t){for(let e=0,i=t.length;e<i;e++)s[e]=t[e]}function eo(s,t){let e=zc[t];e===void 0&&(e=new Int32Array(t),zc[t]=e);for(let i=0;i!==t;++i)e[i]=s.allocateTextureUnit();return e}function Bg(s,t){const e=this.cache;e[0]!==t&&(s.uniform1f(this.addr,t),e[0]=t)}function kg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ee(e,t))return;s.uniform2fv(this.addr,t),we(e,t)}}function Vg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(s.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(Ee(e,t))return;s.uniform3fv(this.addr,t),we(e,t)}}function Gg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ee(e,t))return;s.uniform4fv(this.addr,t),we(e,t)}}function Hg(s,t){const e=this.cache,i=t.elements;if(i===void 0){if(Ee(e,t))return;s.uniformMatrix2fv(this.addr,!1,t),we(e,t)}else{if(Ee(e,i))return;Vc.set(i),s.uniformMatrix2fv(this.addr,!1,Vc),we(e,i)}}function Wg(s,t){const e=this.cache,i=t.elements;if(i===void 0){if(Ee(e,t))return;s.uniformMatrix3fv(this.addr,!1,t),we(e,t)}else{if(Ee(e,i))return;kc.set(i),s.uniformMatrix3fv(this.addr,!1,kc),we(e,i)}}function Xg(s,t){const e=this.cache,i=t.elements;if(i===void 0){if(Ee(e,t))return;s.uniformMatrix4fv(this.addr,!1,t),we(e,t)}else{if(Ee(e,i))return;Bc.set(i),s.uniformMatrix4fv(this.addr,!1,Bc),we(e,i)}}function qg(s,t){const e=this.cache;e[0]!==t&&(s.uniform1i(this.addr,t),e[0]=t)}function Yg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ee(e,t))return;s.uniform2iv(this.addr,t),we(e,t)}}function $g(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Ee(e,t))return;s.uniform3iv(this.addr,t),we(e,t)}}function Zg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ee(e,t))return;s.uniform4iv(this.addr,t),we(e,t)}}function Kg(s,t){const e=this.cache;e[0]!==t&&(s.uniform1ui(this.addr,t),e[0]=t)}function Jg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Ee(e,t))return;s.uniform2uiv(this.addr,t),we(e,t)}}function Qg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Ee(e,t))return;s.uniform3uiv(this.addr,t),we(e,t)}}function jg(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Ee(e,t))return;s.uniform4uiv(this.addr,t),we(e,t)}}function tx(s,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(s.uniform1i(this.addr,n),i[0]=n);let r;this.type===s.SAMPLER_2D_SHADOW?(ih.compareFunction=e.isReversedDepthBuffer()?bh:Sh,r=ih):r=Rd,e.setTexture2D(t||r,n)}function ex(s,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(s.uniform1i(this.addr,n),i[0]=n),e.setTexture3D(t||Pd,n)}function ix(s,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(s.uniform1i(this.addr,n),i[0]=n),e.setTextureCube(t||Dd,n)}function nx(s,t,e){const i=this.cache,n=e.allocateTextureUnit();i[0]!==n&&(s.uniform1i(this.addr,n),i[0]=n),e.setTexture2DArray(t||Cd,n)}function sx(s){switch(s){case 5126:return Bg;case 35664:return kg;case 35665:return Vg;case 35666:return Gg;case 35674:return Hg;case 35675:return Wg;case 35676:return Xg;case 5124:case 35670:return qg;case 35667:case 35671:return Yg;case 35668:case 35672:return $g;case 35669:case 35673:return Zg;case 5125:return Kg;case 36294:return Jg;case 36295:return Qg;case 36296:return jg;case 35678:case 36198:case 36298:case 36306:case 35682:return tx;case 35679:case 36299:case 36307:return ex;case 35680:case 36300:case 36308:case 36293:return ix;case 36289:case 36303:case 36311:case 36292:return nx}}function rx(s,t){s.uniform1fv(this.addr,t)}function ax(s,t){const e=Ys(t,this.size,2);s.uniform2fv(this.addr,e)}function ox(s,t){const e=Ys(t,this.size,3);s.uniform3fv(this.addr,e)}function lx(s,t){const e=Ys(t,this.size,4);s.uniform4fv(this.addr,e)}function hx(s,t){const e=Ys(t,this.size,4);s.uniformMatrix2fv(this.addr,!1,e)}function cx(s,t){const e=Ys(t,this.size,9);s.uniformMatrix3fv(this.addr,!1,e)}function ux(s,t){const e=Ys(t,this.size,16);s.uniformMatrix4fv(this.addr,!1,e)}function dx(s,t){s.uniform1iv(this.addr,t)}function fx(s,t){s.uniform2iv(this.addr,t)}function px(s,t){s.uniform3iv(this.addr,t)}function mx(s,t){s.uniform4iv(this.addr,t)}function gx(s,t){s.uniform1uiv(this.addr,t)}function xx(s,t){s.uniform2uiv(this.addr,t)}function _x(s,t){s.uniform3uiv(this.addr,t)}function yx(s,t){s.uniform4uiv(this.addr,t)}function Mx(s,t,e){const i=this.cache,n=t.length,r=eo(e,n);Ee(i,r)||(s.uniform1iv(this.addr,r),we(i,r));let a;this.type===s.SAMPLER_2D_SHADOW?a=ih:a=Rd;for(let o=0;o!==n;++o)e.setTexture2D(t[o]||a,r[o])}function vx(s,t,e){const i=this.cache,n=t.length,r=eo(e,n);Ee(i,r)||(s.uniform1iv(this.addr,r),we(i,r));for(let a=0;a!==n;++a)e.setTexture3D(t[a]||Pd,r[a])}function Sx(s,t,e){const i=this.cache,n=t.length,r=eo(e,n);Ee(i,r)||(s.uniform1iv(this.addr,r),we(i,r));for(let a=0;a!==n;++a)e.setTextureCube(t[a]||Dd,r[a])}function bx(s,t,e){const i=this.cache,n=t.length,r=eo(e,n);Ee(i,r)||(s.uniform1iv(this.addr,r),we(i,r));for(let a=0;a!==n;++a)e.setTexture2DArray(t[a]||Cd,r[a])}function Ex(s){switch(s){case 5126:return rx;case 35664:return ax;case 35665:return ox;case 35666:return lx;case 35674:return hx;case 35675:return cx;case 35676:return ux;case 5124:case 35670:return dx;case 35667:case 35671:return fx;case 35668:case 35672:return px;case 35669:case 35673:return mx;case 5125:return gx;case 36294:return xx;case 36295:return _x;case 36296:return yx;case 35678:case 36198:case 36298:case 36306:case 35682:return Mx;case 35679:case 36299:case 36307:return vx;case 35680:case 36300:case 36308:case 36293:return Sx;case 36289:case 36303:case 36311:case 36292:return bx}}class wx{constructor(t,e,i){this.id=t,this.addr=i,this.cache=[],this.type=e.type,this.setValue=sx(e.type)}}class Tx{constructor(t,e,i){this.id=t,this.addr=i,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=Ex(e.type)}}class Ax{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,i){const n=this.seq;for(let r=0,a=n.length;r!==a;++r){const o=n[r];o.setValue(t,e[o.id],i)}}}const Fo=/(\w+)(\])?(\[|\.)?/g;function Gc(s,t){s.seq.push(t),s.map[t.id]=t}function Rx(s,t,e){const i=s.name,n=i.length;for(Fo.lastIndex=0;;){const r=Fo.exec(i),a=Fo.lastIndex;let o=r[1];const l=r[2]==="]",h=r[3];if(l&&(o=o|0),h===void 0||h==="["&&a+2===n){Gc(e,h===void 0?new wx(o,s,t):new Tx(o,s,t));break}else{let d=e.map[o];d===void 0&&(d=new Ax(o),Gc(e,d)),e=d}}}class za{constructor(t,e){this.seq=[],this.map={};const i=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let a=0;a<i;++a){const o=t.getActiveUniform(e,a),l=t.getUniformLocation(e,o.name);Rx(o,l,this)}const n=[],r=[];for(const a of this.seq)a.type===t.SAMPLER_2D_SHADOW||a.type===t.SAMPLER_CUBE_SHADOW||a.type===t.SAMPLER_2D_ARRAY_SHADOW?n.push(a):r.push(a);n.length>0&&(this.seq=n.concat(r))}setValue(t,e,i,n){const r=this.map[e];r!==void 0&&r.setValue(t,i,n)}setOptional(t,e,i){const n=e[i];n!==void 0&&this.setValue(t,i,n)}static upload(t,e,i,n){for(let r=0,a=e.length;r!==a;++r){const o=e[r],l=i[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,n)}}static seqWithValue(t,e){const i=[];for(let n=0,r=t.length;n!==r;++n){const a=t[n];a.id in e&&i.push(a)}return i}}function Hc(s,t,e){const i=s.createShader(t);return s.shaderSource(i,e),s.compileShader(i),i}const Cx=37297;let Px=0;function Dx(s,t){const e=s.split(`
`),i=[],n=Math.max(t-6,0),r=Math.min(t+6,e.length);for(let a=n;a<r;a++){const o=a+1;i.push(`${o===t?">":" "} ${o}: ${e[a]}`)}return i.join(`
`)}const Wc=new Ft;function Ix(s){kt._getMatrix(Wc,kt.workingColorSpace,s);const t=`mat3( ${Wc.elements.map(e=>e.toFixed(4))} )`;switch(kt.getTransfer(s)){case Xa:return[t,"LinearTransferOETF"];case Kt:return[t,"sRGBTransferOETF"];default:return Rt("WebGLProgram: Unsupported color space: ",s),[t,"LinearTransferOETF"]}}function Xc(s,t,e){const i=s.getShaderParameter(t,s.COMPILE_STATUS),r=(s.getShaderInfoLog(t)||"").trim();if(i&&r==="")return"";const a=/ERROR: 0:(\d+)/.exec(r);if(a){const o=parseInt(a[1]);return e.toUpperCase()+`

`+r+`

`+Dx(s.getShaderSource(t),o)}else return r}function Lx(s,t){const e=Ix(t);return[`vec4 ${s}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}const Nx={[ch]:"Linear",[uh]:"Reinhard",[dh]:"Cineon",[fh]:"ACESFilmic",[ph]:"AgX",[Qa]:"Neutral",[$u]:"Custom"};function Fx(s,t){const e=Nx[t];return e===void 0?(Rt("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+s+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+s+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const ta=new U;function Ux(){kt.getLuminanceCoefficients(ta);const s=ta.x.toFixed(4),t=ta.y.toFixed(4),e=ta.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Ox(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(pr).join(`
`)}function zx(s){const t=[];for(const e in s){const i=s[e];i!==!1&&t.push("#define "+e+" "+i)}return t.join(`
`)}function Bx(s,t){const e={},i=s.getProgramParameter(t,s.ACTIVE_ATTRIBUTES);for(let n=0;n<i;n++){const r=s.getActiveAttrib(t,n),a=r.name;let o=1;r.type===s.FLOAT_MAT2&&(o=2),r.type===s.FLOAT_MAT3&&(o=3),r.type===s.FLOAT_MAT4&&(o=4),e[a]={type:r.type,location:s.getAttribLocation(t,a),locationSize:o}}return e}function pr(s){return s!==""}function qc(s,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function Yc(s,t){return s.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const kx=/^[ \t]*#include +<([\w\d./]+)>/gm;function nh(s){return s.replace(kx,Gx)}const Vx=new Map;function Gx(s,t){let e=Ut[t];if(e===void 0){const i=Vx.get(t);if(i!==void 0)e=Ut[i],Rt('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,i);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return nh(e)}const Hx=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function $c(s){return s.replace(Hx,Wx)}function Wx(s,t,e,i){let n="";for(let r=parseInt(t);r<parseInt(e);r++)n+=i.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return n}function Zc(s){let t=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?t+=`
#define HIGH_PRECISION`:s.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}const Xx={[Pa]:"SHADOWMAP_TYPE_PCF",[fr]:"SHADOWMAP_TYPE_VSM"};function qx(s){return Xx[s.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}const Yx={[Gn]:"ENVMAP_TYPE_CUBE",[Gs]:"ENVMAP_TYPE_CUBE",[ja]:"ENVMAP_TYPE_CUBE_UV"};function $x(s){return s.envMap===!1?"ENVMAP_TYPE_CUBE":Yx[s.envMapMode]||"ENVMAP_TYPE_CUBE"}const Zx={[Gs]:"ENVMAP_MODE_REFRACTION"};function Kx(s){return s.envMap===!1?"ENVMAP_MODE_REFLECTION":Zx[s.envMapMode]||"ENVMAP_MODE_REFLECTION"}const Jx={[hh]:"ENVMAP_BLENDING_MULTIPLY",[Mf]:"ENVMAP_BLENDING_MIX",[vf]:"ENVMAP_BLENDING_ADD"};function Qx(s){return s.envMap===!1?"ENVMAP_BLENDING_NONE":Jx[s.combine]||"ENVMAP_BLENDING_NONE"}function jx(s){const t=s.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,i=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:i,maxMip:e}}function t_(s,t,e,i){const n=s.getContext(),r=e.defines;let a=e.vertexShader,o=e.fragmentShader;const l=qx(e),h=$x(e),u=Kx(e),d=Qx(e),c=jx(e),f=Ox(e),g=zx(r),_=n.createProgram();let m,p,v=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(pr).join(`
`),m.length>0&&(m+=`
`),p=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(pr).join(`
`),p.length>0&&(p+=`
`)):(m=[Zc(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+u:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexNormals?"#define HAS_NORMAL":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(pr).join(`
`),p=[Zc(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.envMap?"#define "+u:"",e.envMap?"#define "+d:"",c?"#define CUBEUV_TEXEL_WIDTH "+c.texelWidth:"",c?"#define CUBEUV_TEXEL_HEIGHT "+c.texelHeight:"",c?"#define CUBEUV_MAX_MIP "+c.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor?"#define USE_COLOR":"",e.vertexAlphas||e.batchingColor?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==yi?"#define TONE_MAPPING":"",e.toneMapping!==yi?Ut.tonemapping_pars_fragment:"",e.toneMapping!==yi?Fx("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Ut.colorspace_pars_fragment,Lx("linearToOutputTexel",e.outputColorSpace),Ux(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(pr).join(`
`)),a=nh(a),a=qc(a,e),a=Yc(a,e),o=nh(o),o=qc(o,e),o=Yc(o,e),a=$c(a),o=$c(o),e.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,p=["#define varying in",e.glslVersion===ec?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===ec?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);const E=v+m+a,M=v+p+o,T=Hc(n,n.VERTEX_SHADER,E),b=Hc(n,n.FRAGMENT_SHADER,M);n.attachShader(_,T),n.attachShader(_,b),e.index0AttributeName!==void 0?n.bindAttribLocation(_,0,e.index0AttributeName):e.hasPositionAttribute===!0&&n.bindAttribLocation(_,0,"position"),n.linkProgram(_);function A(P){if(s.debug.checkShaderErrors){const D=n.getProgramInfoLog(_)||"",z=n.getShaderInfoLog(T)||"",X=n.getShaderInfoLog(b)||"",N=D.trim(),Y=z.trim(),V=X.trim();let Q=!0,tt=!0;if(n.getProgramParameter(_,n.LINK_STATUS)===!1)if(Q=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(n,_,T,b);else{const nt=Xc(n,T,"vertex"),ct=Xc(n,b,"fragment");Gt("WebGLProgram: Shader Error "+n.getError()+" - VALIDATE_STATUS "+n.getProgramParameter(_,n.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+N+`
`+nt+`
`+ct)}else N!==""?Rt("WebGLProgram: Program Info Log:",N):(Y===""||V==="")&&(tt=!1);tt&&(P.diagnostics={runnable:Q,programLog:N,vertexShader:{log:Y,prefix:m},fragmentShader:{log:V,prefix:p}})}n.deleteShader(T),n.deleteShader(b),x=new za(n,_),w=Bx(n,_)}let x;this.getUniforms=function(){return x===void 0&&A(this),x};let w;this.getAttributes=function(){return w===void 0&&A(this),w};let C=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return C===!1&&(C=n.getProgramParameter(_,Cx)),C},this.destroy=function(){i.releaseStatesOfProgram(this),n.deleteProgram(_),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=Px++,this.cacheKey=t,this.usedTimes=1,this.program=_,this.vertexShader=T,this.fragmentShader=b,this}let e_=0;class i_{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,e,i){const n=this._getShaderCacheForMaterial(t);return n.has(e)===!1&&(n.add(e),e.usedTimes++),n.has(i)===!1&&(n.add(i),i.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const i of e)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let i=e.get(t);return i===void 0&&(i=new Set,e.set(t,i)),i}_getShaderStage(t){const e=this.shaderCache;let i=e.get(t);return i===void 0&&(i=new n_(t),e.set(t,i)),i}}class n_{constructor(t){this.id=e_++,this.code=t,this.usedTimes=0}}function s_(s){return s===Hn||s===Va||s===Ga}function r_(s,t,e,i,n,r){const a=new Th,o=new i_,l=new Set,h=[],u=new Map,d=i.logarithmicDepthBuffer;let c=i.precision;const f={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function g(x){return l.add(x),x===0?"uv":`uv${x}`}function _(x,w,C,P,D,z){const X=P.fog,N=D.geometry,Y=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?P.environment:null,V=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,Q=t.get(x.envMap||Y,V),tt=Q&&Q.mapping===ja?Q.image.height:null,nt=f[x.type];x.precision!==null&&(c=i.getMaxPrecision(x.precision),c!==x.precision&&Rt("WebGLProgram.getParameters:",x.precision,"not supported, using",c,"instead."));const ct=N.morphAttributes.position||N.morphAttributes.normal||N.morphAttributes.color,_t=ct!==void 0?ct.length:0;let Xt=0;N.morphAttributes.position!==void 0&&(Xt=1),N.morphAttributes.normal!==void 0&&(Xt=2),N.morphAttributes.color!==void 0&&(Xt=3);let le,qt,J,rt;if(nt){const yt=Ci[nt];le=yt.vertexShader,qt=yt.fragmentShader}else{le=x.vertexShader,qt=x.fragmentShader;const yt=o.getVertexShaderStage(x),ce=o.getFragmentShaderStage(x);o.update(x,yt,ce),J=yt.id,rt=ce.id}const et=s.getRenderTarget(),Ct=s.state.buffers.depth.getReversed(),It=D.isInstancedMesh===!0,Tt=D.isBatchedMesh===!0,de=!!x.map,Bt=!!x.matcap,te=!!Q,Yt=!!x.aoMap,Ht=!!x.lightMap,ge=!!x.bumpMap&&x.wireframe===!1,ve=!!x.normalMap,Te=!!x.displacementMap,Pe=!!x.emissiveMap,he=!!x.metalnessMap,xe=!!x.roughnessMap,L=x.anisotropy>0,We=x.clearcoat>0,Zt=x.dispersion>0,R=x.iridescence>0,y=x.sheen>0,O=x.transmission>0,G=L&&!!x.anisotropyMap,q=We&&!!x.clearcoatMap,it=We&&!!x.clearcoatNormalMap,at=We&&!!x.clearcoatRoughnessMap,$=R&&!!x.iridescenceMap,K=R&&!!x.iridescenceThicknessMap,ot=y&&!!x.sheenColorMap,St=y&&!!x.sheenRoughnessMap,ut=!!x.specularMap,lt=!!x.specularColorMap,wt=!!x.specularIntensityMap,At=O&&!!x.transmissionMap,Lt=O&&!!x.thicknessMap,I=!!x.gradientMap,st=!!x.alphaMap,Z=x.alphaTest>0,ht=!!x.alphaHash,mt=!!x.extensions;let j=yi;x.toneMapped&&(et===null||et.isXRRenderTarget===!0)&&(j=s.toneMapping);const vt={shaderID:nt,shaderType:x.type,shaderName:x.name,vertexShader:le,fragmentShader:qt,defines:x.defines,customVertexShaderID:J,customFragmentShaderID:rt,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:c,batching:Tt,batchingColor:Tt&&D._colorsTexture!==null,instancing:It,instancingColor:It&&D.instanceColor!==null,instancingMorph:It&&D.morphTexture!==null,outputColorSpace:et===null?s.outputColorSpace:et.isXRRenderTarget===!0?et.texture.colorSpace:kt.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:de,matcap:Bt,envMap:te,envMapMode:te&&Q.mapping,envMapCubeUVHeight:tt,aoMap:Yt,lightMap:Ht,bumpMap:ge,normalMap:ve,displacementMap:Te,emissiveMap:Pe,normalMapObjectSpace:ve&&x.normalMapType===Ef,normalMapTangentSpace:ve&&x.normalMapType===Ha,packedNormalMap:ve&&x.normalMapType===Ha&&s_(x.normalMap.format),metalnessMap:he,roughnessMap:xe,anisotropy:L,anisotropyMap:G,clearcoat:We,clearcoatMap:q,clearcoatNormalMap:it,clearcoatRoughnessMap:at,dispersion:Zt,iridescence:R,iridescenceMap:$,iridescenceThicknessMap:K,sheen:y,sheenColorMap:ot,sheenRoughnessMap:St,specularMap:ut,specularColorMap:lt,specularIntensityMap:wt,transmission:O,transmissionMap:At,thicknessMap:Lt,gradientMap:I,opaque:x.transparent===!1&&x.blending===Us&&x.alphaToCoverage===!1,alphaMap:st,alphaTest:Z,alphaHash:ht,combine:x.combine,mapUv:de&&g(x.map.channel),aoMapUv:Yt&&g(x.aoMap.channel),lightMapUv:Ht&&g(x.lightMap.channel),bumpMapUv:ge&&g(x.bumpMap.channel),normalMapUv:ve&&g(x.normalMap.channel),displacementMapUv:Te&&g(x.displacementMap.channel),emissiveMapUv:Pe&&g(x.emissiveMap.channel),metalnessMapUv:he&&g(x.metalnessMap.channel),roughnessMapUv:xe&&g(x.roughnessMap.channel),anisotropyMapUv:G&&g(x.anisotropyMap.channel),clearcoatMapUv:q&&g(x.clearcoatMap.channel),clearcoatNormalMapUv:it&&g(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:at&&g(x.clearcoatRoughnessMap.channel),iridescenceMapUv:$&&g(x.iridescenceMap.channel),iridescenceThicknessMapUv:K&&g(x.iridescenceThicknessMap.channel),sheenColorMapUv:ot&&g(x.sheenColorMap.channel),sheenRoughnessMapUv:St&&g(x.sheenRoughnessMap.channel),specularMapUv:ut&&g(x.specularMap.channel),specularColorMapUv:lt&&g(x.specularColorMap.channel),specularIntensityMapUv:wt&&g(x.specularIntensityMap.channel),transmissionMapUv:At&&g(x.transmissionMap.channel),thicknessMapUv:Lt&&g(x.thicknessMap.channel),alphaMapUv:st&&g(x.alphaMap.channel),vertexTangents:!!N.attributes.tangent&&(ve||L),vertexNormals:!!N.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!N.attributes.color&&N.attributes.color.itemSize===4,pointsUvs:D.isPoints===!0&&!!N.attributes.uv&&(de||st),fog:!!X,useFog:x.fog===!0,fogExp2:!!X&&X.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||N.attributes.normal===void 0&&ve===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:Ct,skinning:D.isSkinnedMesh===!0,hasPositionAttribute:N.attributes.position!==void 0,morphTargets:N.morphAttributes.position!==void 0,morphNormals:N.morphAttributes.normal!==void 0,morphColors:N.morphAttributes.color!==void 0,morphTargetsCount:_t,morphTextureStride:Xt,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numLightProbeGrids:z.length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:x.dithering,shadowMapEnabled:s.shadowMap.enabled&&C.length>0,shadowMapType:s.shadowMap.type,toneMapping:j,decodeVideoTexture:de&&x.map.isVideoTexture===!0&&kt.getTransfer(x.map.colorSpace)===Kt,decodeVideoTextureEmissive:Pe&&x.emissiveMap.isVideoTexture===!0&&kt.getTransfer(x.emissiveMap.colorSpace)===Kt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===Yi,flipSided:x.side===Le,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:mt&&x.extensions.clipCullDistance===!0&&e.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(mt&&x.extensions.multiDraw===!0||Tt)&&e.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:e.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return vt.vertexUv1s=l.has(1),vt.vertexUv2s=l.has(2),vt.vertexUv3s=l.has(3),l.clear(),vt}function m(x){const w=[];if(x.shaderID?w.push(x.shaderID):(w.push(x.customVertexShaderID),w.push(x.customFragmentShaderID)),x.defines!==void 0)for(const C in x.defines)w.push(C),w.push(x.defines[C]);return x.isRawShaderMaterial===!1&&(p(w,x),v(w,x),w.push(s.outputColorSpace)),w.push(x.customProgramCacheKey),w.join()}function p(x,w){x.push(w.precision),x.push(w.outputColorSpace),x.push(w.envMapMode),x.push(w.envMapCubeUVHeight),x.push(w.mapUv),x.push(w.alphaMapUv),x.push(w.lightMapUv),x.push(w.aoMapUv),x.push(w.bumpMapUv),x.push(w.normalMapUv),x.push(w.displacementMapUv),x.push(w.emissiveMapUv),x.push(w.metalnessMapUv),x.push(w.roughnessMapUv),x.push(w.anisotropyMapUv),x.push(w.clearcoatMapUv),x.push(w.clearcoatNormalMapUv),x.push(w.clearcoatRoughnessMapUv),x.push(w.iridescenceMapUv),x.push(w.iridescenceThicknessMapUv),x.push(w.sheenColorMapUv),x.push(w.sheenRoughnessMapUv),x.push(w.specularMapUv),x.push(w.specularColorMapUv),x.push(w.specularIntensityMapUv),x.push(w.transmissionMapUv),x.push(w.thicknessMapUv),x.push(w.combine),x.push(w.fogExp2),x.push(w.sizeAttenuation),x.push(w.morphTargetsCount),x.push(w.morphAttributeCount),x.push(w.numDirLights),x.push(w.numPointLights),x.push(w.numSpotLights),x.push(w.numSpotLightMaps),x.push(w.numHemiLights),x.push(w.numRectAreaLights),x.push(w.numDirLightShadows),x.push(w.numPointLightShadows),x.push(w.numSpotLightShadows),x.push(w.numSpotLightShadowsWithMaps),x.push(w.numLightProbes),x.push(w.shadowMapType),x.push(w.toneMapping),x.push(w.numClippingPlanes),x.push(w.numClipIntersection),x.push(w.depthPacking)}function v(x,w){a.disableAll(),w.instancing&&a.enable(0),w.instancingColor&&a.enable(1),w.instancingMorph&&a.enable(2),w.matcap&&a.enable(3),w.envMap&&a.enable(4),w.normalMapObjectSpace&&a.enable(5),w.normalMapTangentSpace&&a.enable(6),w.clearcoat&&a.enable(7),w.iridescence&&a.enable(8),w.alphaTest&&a.enable(9),w.vertexColors&&a.enable(10),w.vertexAlphas&&a.enable(11),w.vertexUv1s&&a.enable(12),w.vertexUv2s&&a.enable(13),w.vertexUv3s&&a.enable(14),w.vertexTangents&&a.enable(15),w.anisotropy&&a.enable(16),w.alphaHash&&a.enable(17),w.batching&&a.enable(18),w.dispersion&&a.enable(19),w.batchingColor&&a.enable(20),w.gradientMap&&a.enable(21),w.packedNormalMap&&a.enable(22),w.vertexNormals&&a.enable(23),x.push(a.mask),a.disableAll(),w.fog&&a.enable(0),w.useFog&&a.enable(1),w.flatShading&&a.enable(2),w.logarithmicDepthBuffer&&a.enable(3),w.reversedDepthBuffer&&a.enable(4),w.skinning&&a.enable(5),w.morphTargets&&a.enable(6),w.morphNormals&&a.enable(7),w.morphColors&&a.enable(8),w.premultipliedAlpha&&a.enable(9),w.shadowMapEnabled&&a.enable(10),w.doubleSided&&a.enable(11),w.flipSided&&a.enable(12),w.useDepthPacking&&a.enable(13),w.dithering&&a.enable(14),w.transmission&&a.enable(15),w.sheen&&a.enable(16),w.opaque&&a.enable(17),w.pointsUvs&&a.enable(18),w.decodeVideoTexture&&a.enable(19),w.decodeVideoTextureEmissive&&a.enable(20),w.alphaToCoverage&&a.enable(21),w.numLightProbeGrids>0&&a.enable(22),w.hasPositionAttribute&&a.enable(23),x.push(a.mask)}function E(x){const w=f[x.type];let C;if(w){const P=Ci[w];C=vd.clone(P.uniforms)}else C=x.uniforms;return C}function M(x,w){let C=u.get(w);return C!==void 0?++C.usedTimes:(C=new t_(s,w,x,n),h.push(C),u.set(w,C)),C}function T(x){if(--x.usedTimes===0){const w=h.indexOf(x);h[w]=h[h.length-1],h.pop(),u.delete(x.cacheKey),x.destroy()}}function b(x){o.remove(x)}function A(){o.dispose()}return{getParameters:_,getProgramCacheKey:m,getUniforms:E,acquireProgram:M,releaseProgram:T,releaseShaderCache:b,programs:h,dispose:A}}function a_(){let s=new WeakMap;function t(a){return s.has(a)}function e(a){let o=s.get(a);return o===void 0&&(o={},s.set(a,o)),o}function i(a){s.delete(a)}function n(a,o,l){s.get(a)[o]=l}function r(){s=new WeakMap}return{has:t,get:e,remove:i,update:n,dispose:r}}function o_(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.material.id!==t.material.id?s.material.id-t.material.id:s.materialVariant!==t.materialVariant?s.materialVariant-t.materialVariant:s.z!==t.z?s.z-t.z:s.id-t.id}function Kc(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.z!==t.z?t.z-s.z:s.id-t.id}function Jc(){const s=[];let t=0;const e=[],i=[],n=[];function r(){t=0,e.length=0,i.length=0,n.length=0}function a(c){let f=0;return c.isInstancedMesh&&(f+=2),c.isSkinnedMesh&&(f+=1),f}function o(c,f,g,_,m,p){let v=s[t];return v===void 0?(v={id:c.id,object:c,geometry:f,material:g,materialVariant:a(c),groupOrder:_,renderOrder:c.renderOrder,z:m,group:p},s[t]=v):(v.id=c.id,v.object=c,v.geometry=f,v.material=g,v.materialVariant=a(c),v.groupOrder=_,v.renderOrder=c.renderOrder,v.z=m,v.group=p),t++,v}function l(c,f,g,_,m,p){const v=o(c,f,g,_,m,p);g.transmission>0?i.push(v):g.transparent===!0?n.push(v):e.push(v)}function h(c,f,g,_,m,p){const v=o(c,f,g,_,m,p);g.transmission>0?i.unshift(v):g.transparent===!0?n.unshift(v):e.unshift(v)}function u(c,f,g){e.length>1&&e.sort(c||o_),i.length>1&&i.sort(f||Kc),n.length>1&&n.sort(f||Kc),g&&(e.reverse(),i.reverse(),n.reverse())}function d(){for(let c=t,f=s.length;c<f;c++){const g=s[c];if(g.id===null)break;g.id=null,g.object=null,g.geometry=null,g.material=null,g.group=null}}return{opaque:e,transmissive:i,transparent:n,init:r,push:l,unshift:h,finish:d,sort:u}}function l_(){let s=new WeakMap;function t(i,n){const r=s.get(i);let a;return r===void 0?(a=new Jc,s.set(i,[a])):n>=r.length?(a=new Jc,r.push(a)):a=r[n],a}function e(){s=new WeakMap}return{get:t,dispose:e}}function h_(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new U,color:new Dt};break;case"SpotLight":e={position:new U,direction:new U,color:new Dt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new U,color:new Dt,distance:0,decay:0};break;case"HemisphereLight":e={direction:new U,skyColor:new Dt,groundColor:new Dt};break;case"RectAreaLight":e={color:new Dt,position:new U,halfWidth:new U,halfHeight:new U};break}return s[t.id]=e,e}}}function c_(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Pt};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Pt};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Pt,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[t.id]=e,e}}}let u_=0;function d_(s,t){return(t.castShadow?2:0)-(s.castShadow?2:0)+(t.map?1:0)-(s.map?1:0)}function f_(s){const t=new h_,e=c_(),i={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)i.probe.push(new U);const n=new U,r=new oe,a=new oe;function o(h){let u=0,d=0,c=0;for(let w=0;w<9;w++)i.probe[w].set(0,0,0);let f=0,g=0,_=0,m=0,p=0,v=0,E=0,M=0,T=0,b=0,A=0;h.sort(d_);for(let w=0,C=h.length;w<C;w++){const P=h[w],D=P.color,z=P.intensity,X=P.distance;let N=null;if(P.shadow&&P.shadow.map&&(P.shadow.map.texture.format===Hn?N=P.shadow.map.texture:N=P.shadow.map.depthTexture||P.shadow.map.texture),P.isAmbientLight)u+=D.r*z,d+=D.g*z,c+=D.b*z;else if(P.isLightProbe){for(let Y=0;Y<9;Y++)i.probe[Y].addScaledVector(P.sh.coefficients[Y],z);A++}else if(P.isDirectionalLight){const Y=t.get(P);if(Y.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){const V=P.shadow,Q=e.get(P);Q.shadowIntensity=V.intensity,Q.shadowBias=V.bias,Q.shadowNormalBias=V.normalBias,Q.shadowRadius=V.radius,Q.shadowMapSize=V.mapSize,i.directionalShadow[f]=Q,i.directionalShadowMap[f]=N,i.directionalShadowMatrix[f]=P.shadow.matrix,v++}i.directional[f]=Y,f++}else if(P.isSpotLight){const Y=t.get(P);Y.position.setFromMatrixPosition(P.matrixWorld),Y.color.copy(D).multiplyScalar(z),Y.distance=X,Y.coneCos=Math.cos(P.angle),Y.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),Y.decay=P.decay,i.spot[_]=Y;const V=P.shadow;if(P.map&&(i.spotLightMap[T]=P.map,T++,V.updateMatrices(P),P.castShadow&&b++),i.spotLightMatrix[_]=V.matrix,P.castShadow){const Q=e.get(P);Q.shadowIntensity=V.intensity,Q.shadowBias=V.bias,Q.shadowNormalBias=V.normalBias,Q.shadowRadius=V.radius,Q.shadowMapSize=V.mapSize,i.spotShadow[_]=Q,i.spotShadowMap[_]=N,M++}_++}else if(P.isRectAreaLight){const Y=t.get(P);Y.color.copy(D).multiplyScalar(z),Y.halfWidth.set(P.width*.5,0,0),Y.halfHeight.set(0,P.height*.5,0),i.rectArea[m]=Y,m++}else if(P.isPointLight){const Y=t.get(P);if(Y.color.copy(P.color).multiplyScalar(P.intensity),Y.distance=P.distance,Y.decay=P.decay,P.castShadow){const V=P.shadow,Q=e.get(P);Q.shadowIntensity=V.intensity,Q.shadowBias=V.bias,Q.shadowNormalBias=V.normalBias,Q.shadowRadius=V.radius,Q.shadowMapSize=V.mapSize,Q.shadowCameraNear=V.camera.near,Q.shadowCameraFar=V.camera.far,i.pointShadow[g]=Q,i.pointShadowMap[g]=N,i.pointShadowMatrix[g]=P.shadow.matrix,E++}i.point[g]=Y,g++}else if(P.isHemisphereLight){const Y=t.get(P);Y.skyColor.copy(P.color).multiplyScalar(z),Y.groundColor.copy(P.groundColor).multiplyScalar(z),i.hemi[p]=Y,p++}}m>0&&(s.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=dt.LTC_FLOAT_1,i.rectAreaLTC2=dt.LTC_FLOAT_2):(i.rectAreaLTC1=dt.LTC_HALF_1,i.rectAreaLTC2=dt.LTC_HALF_2)),i.ambient[0]=u,i.ambient[1]=d,i.ambient[2]=c;const x=i.hash;(x.directionalLength!==f||x.pointLength!==g||x.spotLength!==_||x.rectAreaLength!==m||x.hemiLength!==p||x.numDirectionalShadows!==v||x.numPointShadows!==E||x.numSpotShadows!==M||x.numSpotMaps!==T||x.numLightProbes!==A)&&(i.directional.length=f,i.spot.length=_,i.rectArea.length=m,i.point.length=g,i.hemi.length=p,i.directionalShadow.length=v,i.directionalShadowMap.length=v,i.pointShadow.length=E,i.pointShadowMap.length=E,i.spotShadow.length=M,i.spotShadowMap.length=M,i.directionalShadowMatrix.length=v,i.pointShadowMatrix.length=E,i.spotLightMatrix.length=M+T-b,i.spotLightMap.length=T,i.numSpotLightShadowsWithMaps=b,i.numLightProbes=A,x.directionalLength=f,x.pointLength=g,x.spotLength=_,x.rectAreaLength=m,x.hemiLength=p,x.numDirectionalShadows=v,x.numPointShadows=E,x.numSpotShadows=M,x.numSpotMaps=T,x.numLightProbes=A,i.version=u_++)}function l(h,u){let d=0,c=0,f=0,g=0,_=0;const m=u.matrixWorldInverse;for(let p=0,v=h.length;p<v;p++){const E=h[p];if(E.isDirectionalLight){const M=i.directional[d];M.direction.setFromMatrixPosition(E.matrixWorld),n.setFromMatrixPosition(E.target.matrixWorld),M.direction.sub(n),M.direction.transformDirection(m),d++}else if(E.isSpotLight){const M=i.spot[f];M.position.setFromMatrixPosition(E.matrixWorld),M.position.applyMatrix4(m),M.direction.setFromMatrixPosition(E.matrixWorld),n.setFromMatrixPosition(E.target.matrixWorld),M.direction.sub(n),M.direction.transformDirection(m),f++}else if(E.isRectAreaLight){const M=i.rectArea[g];M.position.setFromMatrixPosition(E.matrixWorld),M.position.applyMatrix4(m),a.identity(),r.copy(E.matrixWorld),r.premultiply(m),a.extractRotation(r),M.halfWidth.set(E.width*.5,0,0),M.halfHeight.set(0,E.height*.5,0),M.halfWidth.applyMatrix4(a),M.halfHeight.applyMatrix4(a),g++}else if(E.isPointLight){const M=i.point[c];M.position.setFromMatrixPosition(E.matrixWorld),M.position.applyMatrix4(m),c++}else if(E.isHemisphereLight){const M=i.hemi[_];M.direction.setFromMatrixPosition(E.matrixWorld),M.direction.transformDirection(m),_++}}}return{setup:o,setupView:l,state:i}}function Qc(s){const t=new f_(s),e=[],i=[],n=[];function r(c){d.camera=c,e.length=0,i.length=0,n.length=0}function a(c){e.push(c)}function o(c){i.push(c)}function l(c){n.push(c)}function h(){t.setup(e)}function u(c){t.setupView(e,c)}const d={lightsArray:e,shadowsArray:i,lightProbeGridArray:n,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:d,setupLights:h,setupLightsView:u,pushLight:a,pushShadow:o,pushLightProbeGrid:l}}function p_(s){let t=new WeakMap;function e(n,r=0){const a=t.get(n);let o;return a===void 0?(o=new Qc(s),t.set(n,[o])):r>=a.length?(o=new Qc(s),a.push(o)):o=a[r],o}function i(){t=new WeakMap}return{get:e,dispose:i}}const m_=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,g_=`uniform sampler2D shadow_pass;
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
}`,x_=[new U(1,0,0),new U(-1,0,0),new U(0,1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1)],__=[new U(0,-1,0),new U(0,-1,0),new U(0,0,1),new U(0,0,-1),new U(0,-1,0),new U(0,-1,0)],jc=new oe,ir=new U,Uo=new U;function y_(s,t,e){let i=new Ph;const n=new Pt,r=new Pt,a=new me,o=new Ap,l=new Rp,h={},u=e.maxTextureSize,d={[bn]:Le,[Le]:bn,[Yi]:Yi},c=new hi({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Pt},radius:{value:4}},vertexShader:m_,fragmentShader:g_}),f=c.clone();f.defines.HORIZONTAL_PASS=1;const g=new An;g.setAttribute("position",new Mi(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new Me(g,c),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Pa;let p=this.type;this.render=function(b,A,x){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||b.length===0)return;this.type===Yu&&(Rt("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=Pa);const w=s.getRenderTarget(),C=s.getActiveCubeFace(),P=s.getActiveMipmapLevel(),D=s.state;D.setBlending(Zi),D.buffers.depth.getReversed()===!0?D.buffers.color.setClear(0,0,0,0):D.buffers.color.setClear(1,1,1,1),D.buffers.depth.setTest(!0),D.setScissorTest(!1);const z=p!==this.type;z&&A.traverse(function(X){X.material&&(Array.isArray(X.material)?X.material.forEach(N=>N.needsUpdate=!0):X.material.needsUpdate=!0)});for(let X=0,N=b.length;X<N;X++){const Y=b[X],V=Y.shadow;if(V===void 0){Rt("WebGLShadowMap:",Y,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;n.copy(V.mapSize);const Q=V.getFrameExtents();n.multiply(Q),r.copy(V.mapSize),(n.x>u||n.y>u)&&(n.x>u&&(r.x=Math.floor(u/Q.x),n.x=r.x*Q.x,V.mapSize.x=r.x),n.y>u&&(r.y=Math.floor(u/Q.y),n.y=r.y*Q.y,V.mapSize.y=r.y));const tt=s.state.buffers.depth.getReversed();if(V.camera._reversedDepth=tt,V.map===null||z===!0){if(V.map!==null&&(V.map.depthTexture!==null&&(V.map.depthTexture.dispose(),V.map.depthTexture=null),V.map.dispose()),this.type===fr){if(Y.isPointLight){Rt("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}V.map=new Li(n.x,n.y,{format:Hn,type:Qi,minFilter:Be,magFilter:Be,generateMipmaps:!1}),V.map.texture.name=Y.name+".shadowMap",V.map.depthTexture=new Hs(n.x,n.y,xi),V.map.depthTexture.name=Y.name+".shadowMapDepth",V.map.depthTexture.format=ji,V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=Ie,V.map.depthTexture.magFilter=Ie}else Y.isPointLight?(V.map=new Ad(n.x),V.map.depthTexture=new Mp(n.x,Fi)):(V.map=new Li(n.x,n.y),V.map.depthTexture=new Hs(n.x,n.y,Fi)),V.map.depthTexture.name=Y.name+".shadowMap",V.map.depthTexture.format=ji,this.type===Pa?(V.map.depthTexture.compareFunction=tt?bh:Sh,V.map.depthTexture.minFilter=Be,V.map.depthTexture.magFilter=Be):(V.map.depthTexture.compareFunction=null,V.map.depthTexture.minFilter=Ie,V.map.depthTexture.magFilter=Ie);V.camera.updateProjectionMatrix()}const nt=V.map.isWebGLCubeRenderTarget?6:1;for(let ct=0;ct<nt;ct++){if(V.map.isWebGLCubeRenderTarget)s.setRenderTarget(V.map,ct),s.clear();else{ct===0&&(s.setRenderTarget(V.map),s.clear());const _t=V.getViewport(ct);a.set(r.x*_t.x,r.y*_t.y,r.x*_t.z,r.y*_t.w),D.viewport(a)}if(Y.isPointLight){const _t=V.camera,Xt=V.matrix,le=Y.distance||_t.far;le!==_t.far&&(_t.far=le,_t.updateProjectionMatrix()),ir.setFromMatrixPosition(Y.matrixWorld),_t.position.copy(ir),Uo.copy(_t.position),Uo.add(x_[ct]),_t.up.copy(__[ct]),_t.lookAt(Uo),_t.updateMatrixWorld(),Xt.makeTranslation(-ir.x,-ir.y,-ir.z),jc.multiplyMatrices(_t.projectionMatrix,_t.matrixWorldInverse),V._frustum.setFromProjectionMatrix(jc,_t.coordinateSystem,_t.reversedDepth)}else V.updateMatrices(Y);i=V.getFrustum(),M(A,x,V.camera,Y,this.type)}V.isPointLightShadow!==!0&&this.type===fr&&v(V,x),V.needsUpdate=!1}p=this.type,m.needsUpdate=!1,s.setRenderTarget(w,C,P)};function v(b,A){const x=t.update(_);c.defines.VSM_SAMPLES!==b.blurSamples&&(c.defines.VSM_SAMPLES=b.blurSamples,f.defines.VSM_SAMPLES=b.blurSamples,c.needsUpdate=!0,f.needsUpdate=!0),b.mapPass===null&&(b.mapPass=new Li(n.x,n.y,{format:Hn,type:Qi})),c.uniforms.shadow_pass.value=b.map.depthTexture,c.uniforms.resolution.value=b.mapSize,c.uniforms.radius.value=b.radius,s.setRenderTarget(b.mapPass),s.clear(),s.renderBufferDirect(A,null,x,c,_,null),f.uniforms.shadow_pass.value=b.mapPass.texture,f.uniforms.resolution.value=b.mapSize,f.uniforms.radius.value=b.radius,s.setRenderTarget(b.map),s.clear(),s.renderBufferDirect(A,null,x,f,_,null)}function E(b,A,x,w){let C=null;const P=x.isPointLight===!0?b.customDistanceMaterial:b.customDepthMaterial;if(P!==void 0)C=P;else if(C=x.isPointLight===!0?l:o,s.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0||A.alphaToCoverage===!0){const D=C.uuid,z=A.uuid;let X=h[D];X===void 0&&(X={},h[D]=X);let N=X[z];N===void 0&&(N=C.clone(),X[z]=N,A.addEventListener("dispose",T)),C=N}if(C.visible=A.visible,C.wireframe=A.wireframe,w===fr?C.side=A.shadowSide!==null?A.shadowSide:A.side:C.side=A.shadowSide!==null?A.shadowSide:d[A.side],C.alphaMap=A.alphaMap,C.alphaTest=A.alphaToCoverage===!0?.5:A.alphaTest,C.map=A.map,C.clipShadows=A.clipShadows,C.clippingPlanes=A.clippingPlanes,C.clipIntersection=A.clipIntersection,C.displacementMap=A.displacementMap,C.displacementScale=A.displacementScale,C.displacementBias=A.displacementBias,C.wireframeLinewidth=A.wireframeLinewidth,C.linewidth=A.linewidth,x.isPointLight===!0&&C.isMeshDistanceMaterial===!0){const D=s.properties.get(C);D.light=x}return C}function M(b,A,x,w,C){if(b.visible===!1)return;if(b.layers.test(A.layers)&&(b.isMesh||b.isLine||b.isPoints)&&(b.castShadow||b.receiveShadow&&C===fr)&&(!b.frustumCulled||i.intersectsObject(b))){b.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,b.matrixWorld);const z=t.update(b),X=b.material;if(Array.isArray(X)){const N=z.groups;for(let Y=0,V=N.length;Y<V;Y++){const Q=N[Y],tt=X[Q.materialIndex];if(tt&&tt.visible){const nt=E(b,tt,w,C);b.onBeforeShadow(s,b,A,x,z,nt,Q),s.renderBufferDirect(x,null,z,nt,b,Q),b.onAfterShadow(s,b,A,x,z,nt,Q)}}}else if(X.visible){const N=E(b,X,w,C);b.onBeforeShadow(s,b,A,x,z,N,null),s.renderBufferDirect(x,null,z,N,b,null),b.onAfterShadow(s,b,A,x,z,N,null)}}const D=b.children;for(let z=0,X=D.length;z<X;z++)M(D[z],A,x,w,C)}function T(b){b.target.removeEventListener("dispose",T);for(const x in h){const w=h[x],C=b.target.uuid;C in w&&(w[C].dispose(),delete w[C])}}}function M_(s,t){function e(){let I=!1;const st=new me;let Z=null;const ht=new me(0,0,0,0);return{setMask:function(mt){Z!==mt&&!I&&(s.colorMask(mt,mt,mt,mt),Z=mt)},setLocked:function(mt){I=mt},setClear:function(mt,j,vt,yt,ce){ce===!0&&(mt*=yt,j*=yt,vt*=yt),st.set(mt,j,vt,yt),ht.equals(st)===!1&&(s.clearColor(mt,j,vt,yt),ht.copy(st))},reset:function(){I=!1,Z=null,ht.set(-1,0,0,0)}}}function i(){let I=!1,st=!1,Z=null,ht=null,mt=null;return{setReversed:function(j){if(st!==j){const vt=t.get("EXT_clip_control");j?vt.clipControlEXT(vt.LOWER_LEFT_EXT,vt.ZERO_TO_ONE_EXT):vt.clipControlEXT(vt.LOWER_LEFT_EXT,vt.NEGATIVE_ONE_TO_ONE_EXT),st=j;const yt=mt;mt=null,this.setClear(yt)}},getReversed:function(){return st},setTest:function(j){j?et(s.DEPTH_TEST):Ct(s.DEPTH_TEST)},setMask:function(j){Z!==j&&!I&&(s.depthMask(j),Z=j)},setFunc:function(j){if(st&&(j=Nf[j]),ht!==j){switch(j){case fl:s.depthFunc(s.NEVER);break;case pl:s.depthFunc(s.ALWAYS);break;case ml:s.depthFunc(s.LESS);break;case Vs:s.depthFunc(s.LEQUAL);break;case gl:s.depthFunc(s.EQUAL);break;case xl:s.depthFunc(s.GEQUAL);break;case _l:s.depthFunc(s.GREATER);break;case yl:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}ht=j}},setLocked:function(j){I=j},setClear:function(j){mt!==j&&(mt=j,st&&(j=1-j),s.clearDepth(j))},reset:function(){I=!1,Z=null,ht=null,mt=null,st=!1}}}function n(){let I=!1,st=null,Z=null,ht=null,mt=null,j=null,vt=null,yt=null,ce=null;return{setTest:function(ne){I||(ne?et(s.STENCIL_TEST):Ct(s.STENCIL_TEST))},setMask:function(ne){st!==ne&&!I&&(s.stencilMask(ne),st=ne)},setFunc:function(ne,bi,Ei){(Z!==ne||ht!==bi||mt!==Ei)&&(s.stencilFunc(ne,bi,Ei),Z=ne,ht=bi,mt=Ei)},setOp:function(ne,bi,Ei){(j!==ne||vt!==bi||yt!==Ei)&&(s.stencilOp(ne,bi,Ei),j=ne,vt=bi,yt=Ei)},setLocked:function(ne){I=ne},setClear:function(ne){ce!==ne&&(s.clearStencil(ne),ce=ne)},reset:function(){I=!1,st=null,Z=null,ht=null,mt=null,j=null,vt=null,yt=null,ce=null}}}const r=new e,a=new i,o=new n,l=new WeakMap,h=new WeakMap;let u={},d={},c={},f=new WeakMap,g=[],_=null,m=!1,p=null,v=null,E=null,M=null,T=null,b=null,A=null,x=new Dt(0,0,0),w=0,C=!1,P=null,D=null,z=null,X=null,N=null;const Y=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let V=!1,Q=0;const tt=s.getParameter(s.VERSION);tt.indexOf("WebGL")!==-1?(Q=parseFloat(/^WebGL (\d)/.exec(tt)[1]),V=Q>=1):tt.indexOf("OpenGL ES")!==-1&&(Q=parseFloat(/^OpenGL ES (\d)/.exec(tt)[1]),V=Q>=2);let nt=null,ct={};const _t=s.getParameter(s.SCISSOR_BOX),Xt=s.getParameter(s.VIEWPORT),le=new me().fromArray(_t),qt=new me().fromArray(Xt);function J(I,st,Z,ht){const mt=new Uint8Array(4),j=s.createTexture();s.bindTexture(I,j),s.texParameteri(I,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(I,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let vt=0;vt<Z;vt++)I===s.TEXTURE_3D||I===s.TEXTURE_2D_ARRAY?s.texImage3D(st,0,s.RGBA,1,1,ht,0,s.RGBA,s.UNSIGNED_BYTE,mt):s.texImage2D(st+vt,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,mt);return j}const rt={};rt[s.TEXTURE_2D]=J(s.TEXTURE_2D,s.TEXTURE_2D,1),rt[s.TEXTURE_CUBE_MAP]=J(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),rt[s.TEXTURE_2D_ARRAY]=J(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),rt[s.TEXTURE_3D]=J(s.TEXTURE_3D,s.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),et(s.DEPTH_TEST),a.setFunc(Vs),ge(!1),ve(Zh),et(s.CULL_FACE),Yt(Zi);function et(I){u[I]!==!0&&(s.enable(I),u[I]=!0)}function Ct(I){u[I]!==!1&&(s.disable(I),u[I]=!1)}function It(I,st){return c[I]!==st?(s.bindFramebuffer(I,st),c[I]=st,I===s.DRAW_FRAMEBUFFER&&(c[s.FRAMEBUFFER]=st),I===s.FRAMEBUFFER&&(c[s.DRAW_FRAMEBUFFER]=st),!0):!1}function Tt(I,st){let Z=g,ht=!1;if(I){Z=f.get(st),Z===void 0&&(Z=[],f.set(st,Z));const mt=I.textures;if(Z.length!==mt.length||Z[0]!==s.COLOR_ATTACHMENT0){for(let j=0,vt=mt.length;j<vt;j++)Z[j]=s.COLOR_ATTACHMENT0+j;Z.length=mt.length,ht=!0}}else Z[0]!==s.BACK&&(Z[0]=s.BACK,ht=!0);ht&&s.drawBuffers(Z)}function de(I){return _!==I?(s.useProgram(I),_=I,!0):!1}const Bt={[On]:s.FUNC_ADD,[nf]:s.FUNC_SUBTRACT,[sf]:s.FUNC_REVERSE_SUBTRACT};Bt[rf]=s.MIN,Bt[af]=s.MAX;const te={[of]:s.ZERO,[lf]:s.ONE,[hf]:s.SRC_COLOR,[ul]:s.SRC_ALPHA,[mf]:s.SRC_ALPHA_SATURATE,[ff]:s.DST_COLOR,[uf]:s.DST_ALPHA,[cf]:s.ONE_MINUS_SRC_COLOR,[dl]:s.ONE_MINUS_SRC_ALPHA,[pf]:s.ONE_MINUS_DST_COLOR,[df]:s.ONE_MINUS_DST_ALPHA,[gf]:s.CONSTANT_COLOR,[xf]:s.ONE_MINUS_CONSTANT_COLOR,[_f]:s.CONSTANT_ALPHA,[yf]:s.ONE_MINUS_CONSTANT_ALPHA};function Yt(I,st,Z,ht,mt,j,vt,yt,ce,ne){if(I===Zi){m===!0&&(Ct(s.BLEND),m=!1);return}if(m===!1&&(et(s.BLEND),m=!0),I!==ef){if(I!==p||ne!==C){if((v!==On||T!==On)&&(s.blendEquation(s.FUNC_ADD),v=On,T=On),ne)switch(I){case Us:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case Kh:s.blendFunc(s.ONE,s.ONE);break;case Jh:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case Qh:s.blendFuncSeparate(s.DST_COLOR,s.ONE_MINUS_SRC_ALPHA,s.ZERO,s.ONE);break;default:Gt("WebGLState: Invalid blending: ",I);break}else switch(I){case Us:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case Kh:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE,s.ONE,s.ONE);break;case Jh:Gt("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case Qh:Gt("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Gt("WebGLState: Invalid blending: ",I);break}E=null,M=null,b=null,A=null,x.set(0,0,0),w=0,p=I,C=ne}return}mt=mt||st,j=j||Z,vt=vt||ht,(st!==v||mt!==T)&&(s.blendEquationSeparate(Bt[st],Bt[mt]),v=st,T=mt),(Z!==E||ht!==M||j!==b||vt!==A)&&(s.blendFuncSeparate(te[Z],te[ht],te[j],te[vt]),E=Z,M=ht,b=j,A=vt),(yt.equals(x)===!1||ce!==w)&&(s.blendColor(yt.r,yt.g,yt.b,ce),x.copy(yt),w=ce),p=I,C=!1}function Ht(I,st){I.side===Yi?Ct(s.CULL_FACE):et(s.CULL_FACE);let Z=I.side===Le;st&&(Z=!Z),ge(Z),I.blending===Us&&I.transparent===!1?Yt(Zi):Yt(I.blending,I.blendEquation,I.blendSrc,I.blendDst,I.blendEquationAlpha,I.blendSrcAlpha,I.blendDstAlpha,I.blendColor,I.blendAlpha,I.premultipliedAlpha),a.setFunc(I.depthFunc),a.setTest(I.depthTest),a.setMask(I.depthWrite),r.setMask(I.colorWrite);const ht=I.stencilWrite;o.setTest(ht),ht&&(o.setMask(I.stencilWriteMask),o.setFunc(I.stencilFunc,I.stencilRef,I.stencilFuncMask),o.setOp(I.stencilFail,I.stencilZFail,I.stencilZPass)),Pe(I.polygonOffset,I.polygonOffsetFactor,I.polygonOffsetUnits),I.alphaToCoverage===!0?et(s.SAMPLE_ALPHA_TO_COVERAGE):Ct(s.SAMPLE_ALPHA_TO_COVERAGE)}function ge(I){P!==I&&(I?s.frontFace(s.CW):s.frontFace(s.CCW),P=I)}function ve(I){I!==jd?(et(s.CULL_FACE),I!==D&&(I===Zh?s.cullFace(s.BACK):I===tf?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):Ct(s.CULL_FACE),D=I}function Te(I){I!==z&&(V&&s.lineWidth(I),z=I)}function Pe(I,st,Z){I?(et(s.POLYGON_OFFSET_FILL),(X!==st||N!==Z)&&(X=st,N=Z,a.getReversed()&&(st=-st),s.polygonOffset(st,Z))):Ct(s.POLYGON_OFFSET_FILL)}function he(I){I?et(s.SCISSOR_TEST):Ct(s.SCISSOR_TEST)}function xe(I){I===void 0&&(I=s.TEXTURE0+Y-1),nt!==I&&(s.activeTexture(I),nt=I)}function L(I,st,Z){Z===void 0&&(nt===null?Z=s.TEXTURE0+Y-1:Z=nt);let ht=ct[Z];ht===void 0&&(ht={type:void 0,texture:void 0},ct[Z]=ht),(ht.type!==I||ht.texture!==st)&&(nt!==Z&&(s.activeTexture(Z),nt=Z),s.bindTexture(I,st||rt[I]),ht.type=I,ht.texture=st)}function We(){const I=ct[nt];I!==void 0&&I.type!==void 0&&(s.bindTexture(I.type,null),I.type=void 0,I.texture=void 0)}function Zt(){try{s.compressedTexImage2D(...arguments)}catch(I){Gt("WebGLState:",I)}}function R(){try{s.compressedTexImage3D(...arguments)}catch(I){Gt("WebGLState:",I)}}function y(){try{s.texSubImage2D(...arguments)}catch(I){Gt("WebGLState:",I)}}function O(){try{s.texSubImage3D(...arguments)}catch(I){Gt("WebGLState:",I)}}function G(){try{s.compressedTexSubImage2D(...arguments)}catch(I){Gt("WebGLState:",I)}}function q(){try{s.compressedTexSubImage3D(...arguments)}catch(I){Gt("WebGLState:",I)}}function it(){try{s.texStorage2D(...arguments)}catch(I){Gt("WebGLState:",I)}}function at(){try{s.texStorage3D(...arguments)}catch(I){Gt("WebGLState:",I)}}function $(){try{s.texImage2D(...arguments)}catch(I){Gt("WebGLState:",I)}}function K(){try{s.texImage3D(...arguments)}catch(I){Gt("WebGLState:",I)}}function ot(I){return d[I]!==void 0?d[I]:s.getParameter(I)}function St(I,st){d[I]!==st&&(s.pixelStorei(I,st),d[I]=st)}function ut(I){le.equals(I)===!1&&(s.scissor(I.x,I.y,I.z,I.w),le.copy(I))}function lt(I){qt.equals(I)===!1&&(s.viewport(I.x,I.y,I.z,I.w),qt.copy(I))}function wt(I,st){let Z=h.get(st);Z===void 0&&(Z=new WeakMap,h.set(st,Z));let ht=Z.get(I);ht===void 0&&(ht=s.getUniformBlockIndex(st,I.name),Z.set(I,ht))}function At(I,st){const ht=h.get(st).get(I);l.get(st)!==ht&&(s.uniformBlockBinding(st,ht,I.__bindingPointIndex),l.set(st,ht))}function Lt(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),a.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),s.pixelStorei(s.PACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,!1),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,s.BROWSER_DEFAULT_WEBGL),s.pixelStorei(s.PACK_ROW_LENGTH,0),s.pixelStorei(s.PACK_SKIP_PIXELS,0),s.pixelStorei(s.PACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_ROW_LENGTH,0),s.pixelStorei(s.UNPACK_IMAGE_HEIGHT,0),s.pixelStorei(s.UNPACK_SKIP_PIXELS,0),s.pixelStorei(s.UNPACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_SKIP_IMAGES,0),u={},d={},nt=null,ct={},c={},f=new WeakMap,g=[],_=null,m=!1,p=null,v=null,E=null,M=null,T=null,b=null,A=null,x=new Dt(0,0,0),w=0,C=!1,P=null,D=null,z=null,X=null,N=null,le.set(0,0,s.canvas.width,s.canvas.height),qt.set(0,0,s.canvas.width,s.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:et,disable:Ct,bindFramebuffer:It,drawBuffers:Tt,useProgram:de,setBlending:Yt,setMaterial:Ht,setFlipSided:ge,setCullFace:ve,setLineWidth:Te,setPolygonOffset:Pe,setScissorTest:he,activeTexture:xe,bindTexture:L,unbindTexture:We,compressedTexImage2D:Zt,compressedTexImage3D:R,texImage2D:$,texImage3D:K,pixelStorei:St,getParameter:ot,updateUBOMapping:wt,uniformBlockBinding:At,texStorage2D:it,texStorage3D:at,texSubImage2D:y,texSubImage3D:O,compressedTexSubImage2D:G,compressedTexSubImage3D:q,scissor:ut,viewport:lt,reset:Lt}}function v_(s,t,e,i,n,r,a){const o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new Pt,u=new WeakMap,d=new Set;let c;const f=new WeakMap;let g=!1;try{g=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function _(R,y){return g?new OffscreenCanvas(R,y):qa("canvas")}function m(R,y,O){let G=1;const q=Zt(R);if((q.width>O||q.height>O)&&(G=O/Math.max(q.width,q.height)),G<1)if(typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&R instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&R instanceof ImageBitmap||typeof VideoFrame<"u"&&R instanceof VideoFrame){const it=Math.floor(G*q.width),at=Math.floor(G*q.height);c===void 0&&(c=_(it,at));const $=y?_(it,at):c;return $.width=it,$.height=at,$.getContext("2d").drawImage(R,0,0,it,at),Rt("WebGLRenderer: Texture has been resized from ("+q.width+"x"+q.height+") to ("+it+"x"+at+")."),$}else return"data"in R&&Rt("WebGLRenderer: Image in DataTexture is too big ("+q.width+"x"+q.height+")."),R;return R}function p(R){return R.generateMipmaps}function v(R){s.generateMipmap(R)}function E(R){return R.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:R.isWebGL3DRenderTarget?s.TEXTURE_3D:R.isWebGLArrayRenderTarget||R.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function M(R,y,O,G,q,it=!1){if(R!==null){if(s[R]!==void 0)return s[R];Rt("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+R+"'")}let at;G&&(at=t.get("EXT_texture_norm16"),at||Rt("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let $=y;if(y===s.RED&&(O===s.FLOAT&&($=s.R32F),O===s.HALF_FLOAT&&($=s.R16F),O===s.UNSIGNED_BYTE&&($=s.R8),O===s.UNSIGNED_SHORT&&at&&($=at.R16_EXT),O===s.SHORT&&at&&($=at.R16_SNORM_EXT)),y===s.RED_INTEGER&&(O===s.UNSIGNED_BYTE&&($=s.R8UI),O===s.UNSIGNED_SHORT&&($=s.R16UI),O===s.UNSIGNED_INT&&($=s.R32UI),O===s.BYTE&&($=s.R8I),O===s.SHORT&&($=s.R16I),O===s.INT&&($=s.R32I)),y===s.RG&&(O===s.FLOAT&&($=s.RG32F),O===s.HALF_FLOAT&&($=s.RG16F),O===s.UNSIGNED_BYTE&&($=s.RG8),O===s.UNSIGNED_SHORT&&at&&($=at.RG16_EXT),O===s.SHORT&&at&&($=at.RG16_SNORM_EXT)),y===s.RG_INTEGER&&(O===s.UNSIGNED_BYTE&&($=s.RG8UI),O===s.UNSIGNED_SHORT&&($=s.RG16UI),O===s.UNSIGNED_INT&&($=s.RG32UI),O===s.BYTE&&($=s.RG8I),O===s.SHORT&&($=s.RG16I),O===s.INT&&($=s.RG32I)),y===s.RGB_INTEGER&&(O===s.UNSIGNED_BYTE&&($=s.RGB8UI),O===s.UNSIGNED_SHORT&&($=s.RGB16UI),O===s.UNSIGNED_INT&&($=s.RGB32UI),O===s.BYTE&&($=s.RGB8I),O===s.SHORT&&($=s.RGB16I),O===s.INT&&($=s.RGB32I)),y===s.RGBA_INTEGER&&(O===s.UNSIGNED_BYTE&&($=s.RGBA8UI),O===s.UNSIGNED_SHORT&&($=s.RGBA16UI),O===s.UNSIGNED_INT&&($=s.RGBA32UI),O===s.BYTE&&($=s.RGBA8I),O===s.SHORT&&($=s.RGBA16I),O===s.INT&&($=s.RGBA32I)),y===s.RGB&&(O===s.UNSIGNED_SHORT&&at&&($=at.RGB16_EXT),O===s.SHORT&&at&&($=at.RGB16_SNORM_EXT),O===s.UNSIGNED_INT_5_9_9_9_REV&&($=s.RGB9_E5),O===s.UNSIGNED_INT_10F_11F_11F_REV&&($=s.R11F_G11F_B10F)),y===s.RGBA){const K=it?Xa:kt.getTransfer(q);O===s.FLOAT&&($=s.RGBA32F),O===s.HALF_FLOAT&&($=s.RGBA16F),O===s.UNSIGNED_BYTE&&($=K===Kt?s.SRGB8_ALPHA8:s.RGBA8),O===s.UNSIGNED_SHORT&&at&&($=at.RGBA16_EXT),O===s.SHORT&&at&&($=at.RGBA16_SNORM_EXT),O===s.UNSIGNED_SHORT_4_4_4_4&&($=s.RGBA4),O===s.UNSIGNED_SHORT_5_5_5_1&&($=s.RGB5_A1)}return($===s.R16F||$===s.R32F||$===s.RG16F||$===s.RG32F||$===s.RGBA16F||$===s.RGBA32F)&&t.get("EXT_color_buffer_float"),$}function T(R,y){let O;return R?y===null||y===Fi||y===Mr?O=s.DEPTH24_STENCIL8:y===xi?O=s.DEPTH32F_STENCIL8:y===yr&&(O=s.DEPTH24_STENCIL8,Rt("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===Fi||y===Mr?O=s.DEPTH_COMPONENT24:y===xi?O=s.DEPTH_COMPONENT32F:y===yr&&(O=s.DEPTH_COMPONENT16),O}function b(R,y){return p(R)===!0||R.isFramebufferTexture&&R.minFilter!==Ie&&R.minFilter!==Be?Math.log2(Math.max(y.width,y.height))+1:R.mipmaps!==void 0&&R.mipmaps.length>0?R.mipmaps.length:R.isCompressedTexture&&Array.isArray(R.image)?y.mipmaps.length:1}function A(R){const y=R.target;y.removeEventListener("dispose",A),w(y),y.isVideoTexture&&u.delete(y),y.isHTMLTexture&&d.delete(y)}function x(R){const y=R.target;y.removeEventListener("dispose",x),P(y)}function w(R){const y=i.get(R);if(y.__webglInit===void 0)return;const O=R.source,G=f.get(O);if(G){const q=G[y.__cacheKey];q.usedTimes--,q.usedTimes===0&&C(R),Object.keys(G).length===0&&f.delete(O)}i.remove(R)}function C(R){const y=i.get(R);s.deleteTexture(y.__webglTexture);const O=R.source,G=f.get(O);delete G[y.__cacheKey],a.memory.textures--}function P(R){const y=i.get(R);if(R.depthTexture&&(R.depthTexture.dispose(),i.remove(R.depthTexture)),R.isWebGLCubeRenderTarget)for(let G=0;G<6;G++){if(Array.isArray(y.__webglFramebuffer[G]))for(let q=0;q<y.__webglFramebuffer[G].length;q++)s.deleteFramebuffer(y.__webglFramebuffer[G][q]);else s.deleteFramebuffer(y.__webglFramebuffer[G]);y.__webglDepthbuffer&&s.deleteRenderbuffer(y.__webglDepthbuffer[G])}else{if(Array.isArray(y.__webglFramebuffer))for(let G=0;G<y.__webglFramebuffer.length;G++)s.deleteFramebuffer(y.__webglFramebuffer[G]);else s.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&s.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&s.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let G=0;G<y.__webglColorRenderbuffer.length;G++)y.__webglColorRenderbuffer[G]&&s.deleteRenderbuffer(y.__webglColorRenderbuffer[G]);y.__webglDepthRenderbuffer&&s.deleteRenderbuffer(y.__webglDepthRenderbuffer)}const O=R.textures;for(let G=0,q=O.length;G<q;G++){const it=i.get(O[G]);it.__webglTexture&&(s.deleteTexture(it.__webglTexture),a.memory.textures--),i.remove(O[G])}i.remove(R)}let D=0;function z(){D=0}function X(){return D}function N(R){D=R}function Y(){const R=D;return R>=n.maxTextures&&Rt("WebGLTextures: Trying to use "+R+" texture units while this GPU supports only "+n.maxTextures),D+=1,R}function V(R){const y=[];return y.push(R.wrapS),y.push(R.wrapT),y.push(R.wrapR||0),y.push(R.magFilter),y.push(R.minFilter),y.push(R.anisotropy),y.push(R.internalFormat),y.push(R.format),y.push(R.type),y.push(R.generateMipmaps),y.push(R.premultiplyAlpha),y.push(R.flipY),y.push(R.unpackAlignment),y.push(R.colorSpace),y.join()}function Q(R,y){const O=i.get(R);if(R.isVideoTexture&&L(R),R.isRenderTargetTexture===!1&&R.isExternalTexture!==!0&&R.version>0&&O.__version!==R.version){const G=R.image;if(G===null)Rt("WebGLRenderer: Texture marked for update but no image data found.");else if(G.complete===!1)Rt("WebGLRenderer: Texture marked for update but image is incomplete");else{Ct(O,R,y);return}}else R.isExternalTexture&&(O.__webglTexture=R.sourceTexture?R.sourceTexture:null);e.bindTexture(s.TEXTURE_2D,O.__webglTexture,s.TEXTURE0+y)}function tt(R,y){const O=i.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&O.__version!==R.version){Ct(O,R,y);return}else R.isExternalTexture&&(O.__webglTexture=R.sourceTexture?R.sourceTexture:null);e.bindTexture(s.TEXTURE_2D_ARRAY,O.__webglTexture,s.TEXTURE0+y)}function nt(R,y){const O=i.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&O.__version!==R.version){Ct(O,R,y);return}e.bindTexture(s.TEXTURE_3D,O.__webglTexture,s.TEXTURE0+y)}function ct(R,y){const O=i.get(R);if(R.isCubeDepthTexture!==!0&&R.version>0&&O.__version!==R.version){It(O,R,y);return}e.bindTexture(s.TEXTURE_CUBE_MAP,O.__webglTexture,s.TEXTURE0+y)}const _t={[Ml]:s.REPEAT,[$i]:s.CLAMP_TO_EDGE,[vl]:s.MIRRORED_REPEAT},Xt={[Ie]:s.NEAREST,[Sf]:s.NEAREST_MIPMAP_NEAREST,[Ir]:s.NEAREST_MIPMAP_LINEAR,[Be]:s.LINEAR,[ao]:s.LINEAR_MIPMAP_NEAREST,[kn]:s.LINEAR_MIPMAP_LINEAR},le={[wf]:s.NEVER,[Pf]:s.ALWAYS,[Tf]:s.LESS,[Sh]:s.LEQUAL,[Af]:s.EQUAL,[bh]:s.GEQUAL,[Rf]:s.GREATER,[Cf]:s.NOTEQUAL};function qt(R,y){if(y.type===xi&&t.has("OES_texture_float_linear")===!1&&(y.magFilter===Be||y.magFilter===ao||y.magFilter===Ir||y.magFilter===kn||y.minFilter===Be||y.minFilter===ao||y.minFilter===Ir||y.minFilter===kn)&&Rt("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(R,s.TEXTURE_WRAP_S,_t[y.wrapS]),s.texParameteri(R,s.TEXTURE_WRAP_T,_t[y.wrapT]),(R===s.TEXTURE_3D||R===s.TEXTURE_2D_ARRAY)&&s.texParameteri(R,s.TEXTURE_WRAP_R,_t[y.wrapR]),s.texParameteri(R,s.TEXTURE_MAG_FILTER,Xt[y.magFilter]),s.texParameteri(R,s.TEXTURE_MIN_FILTER,Xt[y.minFilter]),y.compareFunction&&(s.texParameteri(R,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(R,s.TEXTURE_COMPARE_FUNC,le[y.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===Ie||y.minFilter!==Ir&&y.minFilter!==kn||y.type===xi&&t.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||i.get(y).__currentAnisotropy){const O=t.get("EXT_texture_filter_anisotropic");s.texParameterf(R,O.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,n.getMaxAnisotropy())),i.get(y).__currentAnisotropy=y.anisotropy}}}function J(R,y){let O=!1;R.__webglInit===void 0&&(R.__webglInit=!0,y.addEventListener("dispose",A));const G=y.source;let q=f.get(G);q===void 0&&(q={},f.set(G,q));const it=V(y);if(it!==R.__cacheKey){q[it]===void 0&&(q[it]={texture:s.createTexture(),usedTimes:0},a.memory.textures++,O=!0),q[it].usedTimes++;const at=q[R.__cacheKey];at!==void 0&&(q[R.__cacheKey].usedTimes--,at.usedTimes===0&&C(y)),R.__cacheKey=it,R.__webglTexture=q[it].texture}return O}function rt(R,y,O){return Math.floor(Math.floor(R/O)/y)}function et(R,y,O,G){const it=R.updateRanges;if(it.length===0)e.texSubImage2D(s.TEXTURE_2D,0,0,0,y.width,y.height,O,G,y.data);else{it.sort((St,ut)=>St.start-ut.start);let at=0;for(let St=1;St<it.length;St++){const ut=it[at],lt=it[St],wt=ut.start+ut.count,At=rt(lt.start,y.width,4),Lt=rt(ut.start,y.width,4);lt.start<=wt+1&&At===Lt&&rt(lt.start+lt.count-1,y.width,4)===At?ut.count=Math.max(ut.count,lt.start+lt.count-ut.start):(++at,it[at]=lt)}it.length=at+1;const $=e.getParameter(s.UNPACK_ROW_LENGTH),K=e.getParameter(s.UNPACK_SKIP_PIXELS),ot=e.getParameter(s.UNPACK_SKIP_ROWS);e.pixelStorei(s.UNPACK_ROW_LENGTH,y.width);for(let St=0,ut=it.length;St<ut;St++){const lt=it[St],wt=Math.floor(lt.start/4),At=Math.ceil(lt.count/4),Lt=wt%y.width,I=Math.floor(wt/y.width),st=At,Z=1;e.pixelStorei(s.UNPACK_SKIP_PIXELS,Lt),e.pixelStorei(s.UNPACK_SKIP_ROWS,I),e.texSubImage2D(s.TEXTURE_2D,0,Lt,I,st,Z,O,G,y.data)}R.clearUpdateRanges(),e.pixelStorei(s.UNPACK_ROW_LENGTH,$),e.pixelStorei(s.UNPACK_SKIP_PIXELS,K),e.pixelStorei(s.UNPACK_SKIP_ROWS,ot)}}function Ct(R,y,O){let G=s.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(G=s.TEXTURE_2D_ARRAY),y.isData3DTexture&&(G=s.TEXTURE_3D);const q=J(R,y),it=y.source;e.bindTexture(G,R.__webglTexture,s.TEXTURE0+O);const at=i.get(it);if(it.version!==at.__version||q===!0){if(e.activeTexture(s.TEXTURE0+O),(typeof ImageBitmap<"u"&&y.image instanceof ImageBitmap)===!1){const Z=kt.getPrimaries(kt.workingColorSpace),ht=y.colorSpace===_n?null:kt.getPrimaries(y.colorSpace),mt=y.colorSpace===_n||Z===ht?s.NONE:s.BROWSER_DEFAULT_WEBGL;e.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,y.flipY),e.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),e.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,mt)}e.pixelStorei(s.UNPACK_ALIGNMENT,y.unpackAlignment);let K=m(y.image,!1,n.maxTextureSize);K=We(y,K);const ot=r.convert(y.format,y.colorSpace),St=r.convert(y.type);let ut=M(y.internalFormat,ot,St,y.normalized,y.colorSpace,y.isVideoTexture);qt(G,y);let lt;const wt=y.mipmaps,At=y.isVideoTexture!==!0,Lt=at.__version===void 0||q===!0,I=it.dataReady,st=b(y,K);if(y.isDepthTexture)ut=T(y.format===Vn,y.type),Lt&&(At?e.texStorage2D(s.TEXTURE_2D,1,ut,K.width,K.height):e.texImage2D(s.TEXTURE_2D,0,ut,K.width,K.height,0,ot,St,null));else if(y.isDataTexture)if(wt.length>0){At&&Lt&&e.texStorage2D(s.TEXTURE_2D,st,ut,wt[0].width,wt[0].height);for(let Z=0,ht=wt.length;Z<ht;Z++)lt=wt[Z],At?I&&e.texSubImage2D(s.TEXTURE_2D,Z,0,0,lt.width,lt.height,ot,St,lt.data):e.texImage2D(s.TEXTURE_2D,Z,ut,lt.width,lt.height,0,ot,St,lt.data);y.generateMipmaps=!1}else At?(Lt&&e.texStorage2D(s.TEXTURE_2D,st,ut,K.width,K.height),I&&et(y,K,ot,St)):e.texImage2D(s.TEXTURE_2D,0,ut,K.width,K.height,0,ot,St,K.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){At&&Lt&&e.texStorage3D(s.TEXTURE_2D_ARRAY,st,ut,wt[0].width,wt[0].height,K.depth);for(let Z=0,ht=wt.length;Z<ht;Z++)if(lt=wt[Z],y.format!==_i)if(ot!==null)if(At){if(I)if(y.layerUpdates.size>0){const mt=Dc(lt.width,lt.height,y.format,y.type);for(const j of y.layerUpdates){const vt=lt.data.subarray(j*mt/lt.data.BYTES_PER_ELEMENT,(j+1)*mt/lt.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,Z,0,0,j,lt.width,lt.height,1,ot,vt)}y.clearLayerUpdates()}else e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,Z,0,0,0,lt.width,lt.height,K.depth,ot,lt.data)}else e.compressedTexImage3D(s.TEXTURE_2D_ARRAY,Z,ut,lt.width,lt.height,K.depth,0,lt.data,0,0);else Rt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else At?I&&e.texSubImage3D(s.TEXTURE_2D_ARRAY,Z,0,0,0,lt.width,lt.height,K.depth,ot,St,lt.data):e.texImage3D(s.TEXTURE_2D_ARRAY,Z,ut,lt.width,lt.height,K.depth,0,ot,St,lt.data)}else{At&&Lt&&e.texStorage2D(s.TEXTURE_2D,st,ut,wt[0].width,wt[0].height);for(let Z=0,ht=wt.length;Z<ht;Z++)lt=wt[Z],y.format!==_i?ot!==null?At?I&&e.compressedTexSubImage2D(s.TEXTURE_2D,Z,0,0,lt.width,lt.height,ot,lt.data):e.compressedTexImage2D(s.TEXTURE_2D,Z,ut,lt.width,lt.height,0,lt.data):Rt("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):At?I&&e.texSubImage2D(s.TEXTURE_2D,Z,0,0,lt.width,lt.height,ot,St,lt.data):e.texImage2D(s.TEXTURE_2D,Z,ut,lt.width,lt.height,0,ot,St,lt.data)}else if(y.isDataArrayTexture)if(At){if(Lt&&e.texStorage3D(s.TEXTURE_2D_ARRAY,st,ut,K.width,K.height,K.depth),I)if(y.layerUpdates.size>0){const Z=Dc(K.width,K.height,y.format,y.type);for(const ht of y.layerUpdates){const mt=K.data.subarray(ht*Z/K.data.BYTES_PER_ELEMENT,(ht+1)*Z/K.data.BYTES_PER_ELEMENT);e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,ht,K.width,K.height,1,ot,St,mt)}y.clearLayerUpdates()}else e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,K.width,K.height,K.depth,ot,St,K.data)}else e.texImage3D(s.TEXTURE_2D_ARRAY,0,ut,K.width,K.height,K.depth,0,ot,St,K.data);else if(y.isData3DTexture)At?(Lt&&e.texStorage3D(s.TEXTURE_3D,st,ut,K.width,K.height,K.depth),I&&e.texSubImage3D(s.TEXTURE_3D,0,0,0,0,K.width,K.height,K.depth,ot,St,K.data)):e.texImage3D(s.TEXTURE_3D,0,ut,K.width,K.height,K.depth,0,ot,St,K.data);else if(y.isFramebufferTexture){if(Lt)if(At)e.texStorage2D(s.TEXTURE_2D,st,ut,K.width,K.height);else{let Z=K.width,ht=K.height;for(let mt=0;mt<st;mt++)e.texImage2D(s.TEXTURE_2D,mt,ut,Z,ht,0,ot,St,null),Z>>=1,ht>>=1}}else if(y.isHTMLTexture){if("texElementImage2D"in s){const Z=s.canvas;if(Z.hasAttribute("layoutsubtree")||Z.setAttribute("layoutsubtree","true"),K.parentNode!==Z){Z.appendChild(K),d.add(y),Z.onpaint=ht=>{const mt=ht.changedElements;for(const j of d)mt.includes(j.image)&&(j.needsUpdate=!0)},Z.requestPaint();return}if(s.texElementImage2D.length===3)s.texElementImage2D(s.TEXTURE_2D,s.RGBA8,K);else{const mt=s.RGBA,j=s.RGBA,vt=s.UNSIGNED_BYTE;s.texElementImage2D(s.TEXTURE_2D,0,mt,j,vt,K)}s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE)}}else if(wt.length>0){if(At&&Lt){const Z=Zt(wt[0]);e.texStorage2D(s.TEXTURE_2D,st,ut,Z.width,Z.height)}for(let Z=0,ht=wt.length;Z<ht;Z++)lt=wt[Z],At?I&&e.texSubImage2D(s.TEXTURE_2D,Z,0,0,ot,St,lt):e.texImage2D(s.TEXTURE_2D,Z,ut,ot,St,lt);y.generateMipmaps=!1}else if(At){if(Lt){const Z=Zt(K);e.texStorage2D(s.TEXTURE_2D,st,ut,Z.width,Z.height)}I&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,ot,St,K)}else e.texImage2D(s.TEXTURE_2D,0,ut,ot,St,K);p(y)&&v(G),at.__version=it.version,y.onUpdate&&y.onUpdate(y)}R.__version=y.version}function It(R,y,O){if(y.image.length!==6)return;const G=J(R,y),q=y.source;e.bindTexture(s.TEXTURE_CUBE_MAP,R.__webglTexture,s.TEXTURE0+O);const it=i.get(q);if(q.version!==it.__version||G===!0){e.activeTexture(s.TEXTURE0+O);const at=kt.getPrimaries(kt.workingColorSpace),$=y.colorSpace===_n?null:kt.getPrimaries(y.colorSpace),K=y.colorSpace===_n||at===$?s.NONE:s.BROWSER_DEFAULT_WEBGL;e.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,y.flipY),e.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),e.pixelStorei(s.UNPACK_ALIGNMENT,y.unpackAlignment),e.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,K);const ot=y.isCompressedTexture||y.image[0].isCompressedTexture,St=y.image[0]&&y.image[0].isDataTexture,ut=[];for(let j=0;j<6;j++)!ot&&!St?ut[j]=m(y.image[j],!0,n.maxCubemapSize):ut[j]=St?y.image[j].image:y.image[j],ut[j]=We(y,ut[j]);const lt=ut[0],wt=r.convert(y.format,y.colorSpace),At=r.convert(y.type),Lt=M(y.internalFormat,wt,At,y.normalized,y.colorSpace),I=y.isVideoTexture!==!0,st=it.__version===void 0||G===!0,Z=q.dataReady;let ht=b(y,lt);qt(s.TEXTURE_CUBE_MAP,y);let mt;if(ot){I&&st&&e.texStorage2D(s.TEXTURE_CUBE_MAP,ht,Lt,lt.width,lt.height);for(let j=0;j<6;j++){mt=ut[j].mipmaps;for(let vt=0;vt<mt.length;vt++){const yt=mt[vt];y.format!==_i?wt!==null?I?Z&&e.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt,0,0,yt.width,yt.height,wt,yt.data):e.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt,Lt,yt.width,yt.height,0,yt.data):Rt("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):I?Z&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt,0,0,yt.width,yt.height,wt,At,yt.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt,Lt,yt.width,yt.height,0,wt,At,yt.data)}}}else{if(mt=y.mipmaps,I&&st){mt.length>0&&ht++;const j=Zt(ut[0]);e.texStorage2D(s.TEXTURE_CUBE_MAP,ht,Lt,j.width,j.height)}for(let j=0;j<6;j++)if(St){I?Z&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,ut[j].width,ut[j].height,wt,At,ut[j].data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Lt,ut[j].width,ut[j].height,0,wt,At,ut[j].data);for(let vt=0;vt<mt.length;vt++){const ce=mt[vt].image[j].image;I?Z&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt+1,0,0,ce.width,ce.height,wt,At,ce.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt+1,Lt,ce.width,ce.height,0,wt,At,ce.data)}}else{I?Z&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,wt,At,ut[j]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Lt,wt,At,ut[j]);for(let vt=0;vt<mt.length;vt++){const yt=mt[vt];I?Z&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt+1,0,0,wt,At,yt.image[j]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,vt+1,Lt,wt,At,yt.image[j])}}}p(y)&&v(s.TEXTURE_CUBE_MAP),it.__version=q.version,y.onUpdate&&y.onUpdate(y)}R.__version=y.version}function Tt(R,y,O,G,q,it){const at=r.convert(O.format,O.colorSpace),$=r.convert(O.type),K=M(O.internalFormat,at,$,O.normalized,O.colorSpace),ot=i.get(y),St=i.get(O);if(St.__renderTarget=y,!ot.__hasExternalTextures){const ut=Math.max(1,y.width>>it),lt=Math.max(1,y.height>>it);q===s.TEXTURE_3D||q===s.TEXTURE_2D_ARRAY?e.texImage3D(q,it,K,ut,lt,y.depth,0,at,$,null):e.texImage2D(q,it,K,ut,lt,0,at,$,null)}e.bindFramebuffer(s.FRAMEBUFFER,R),xe(y)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,G,q,St.__webglTexture,0,he(y)):(q===s.TEXTURE_2D||q>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&q<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,G,q,St.__webglTexture,it),e.bindFramebuffer(s.FRAMEBUFFER,null)}function de(R,y,O){if(s.bindRenderbuffer(s.RENDERBUFFER,R),y.depthBuffer){const G=y.depthTexture,q=G&&G.isDepthTexture?G.type:null,it=T(y.stencilBuffer,q),at=y.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;xe(y)?o.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,he(y),it,y.width,y.height):O?s.renderbufferStorageMultisample(s.RENDERBUFFER,he(y),it,y.width,y.height):s.renderbufferStorage(s.RENDERBUFFER,it,y.width,y.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,at,s.RENDERBUFFER,R)}else{const G=y.textures;for(let q=0;q<G.length;q++){const it=G[q],at=r.convert(it.format,it.colorSpace),$=r.convert(it.type),K=M(it.internalFormat,at,$,it.normalized,it.colorSpace);xe(y)?o.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,he(y),K,y.width,y.height):O?s.renderbufferStorageMultisample(s.RENDERBUFFER,he(y),K,y.width,y.height):s.renderbufferStorage(s.RENDERBUFFER,K,y.width,y.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function Bt(R,y,O){const G=y.isWebGLCubeRenderTarget===!0;if(e.bindFramebuffer(s.FRAMEBUFFER,R),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");const q=i.get(y.depthTexture);if(q.__renderTarget=y,(!q.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),G){if(q.__webglInit===void 0&&(q.__webglInit=!0,y.depthTexture.addEventListener("dispose",A)),q.__webglTexture===void 0){q.__webglTexture=s.createTexture(),e.bindTexture(s.TEXTURE_CUBE_MAP,q.__webglTexture),qt(s.TEXTURE_CUBE_MAP,y.depthTexture);const ot=r.convert(y.depthTexture.format),St=r.convert(y.depthTexture.type);let ut;y.depthTexture.format===ji?ut=s.DEPTH_COMPONENT24:y.depthTexture.format===Vn&&(ut=s.DEPTH24_STENCIL8);for(let lt=0;lt<6;lt++)s.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+lt,0,ut,y.width,y.height,0,ot,St,null)}}else Q(y.depthTexture,0);const it=q.__webglTexture,at=he(y),$=G?s.TEXTURE_CUBE_MAP_POSITIVE_X+O:s.TEXTURE_2D,K=y.depthTexture.format===Vn?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;if(y.depthTexture.format===ji)xe(y)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,K,$,it,0,at):s.framebufferTexture2D(s.FRAMEBUFFER,K,$,it,0);else if(y.depthTexture.format===Vn)xe(y)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,K,$,it,0,at):s.framebufferTexture2D(s.FRAMEBUFFER,K,$,it,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function te(R){const y=i.get(R),O=R.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==R.depthTexture){const G=R.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),G){const q=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,G.removeEventListener("dispose",q)};G.addEventListener("dispose",q),y.__depthDisposeCallback=q}y.__boundDepthTexture=G}if(R.depthTexture&&!y.__autoAllocateDepthBuffer)if(O)for(let G=0;G<6;G++)Bt(y.__webglFramebuffer[G],R,G);else{const G=R.texture.mipmaps;G&&G.length>0?Bt(y.__webglFramebuffer[0],R,0):Bt(y.__webglFramebuffer,R,0)}else if(O){y.__webglDepthbuffer=[];for(let G=0;G<6;G++)if(e.bindFramebuffer(s.FRAMEBUFFER,y.__webglFramebuffer[G]),y.__webglDepthbuffer[G]===void 0)y.__webglDepthbuffer[G]=s.createRenderbuffer(),de(y.__webglDepthbuffer[G],R,!1);else{const q=R.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,it=y.__webglDepthbuffer[G];s.bindRenderbuffer(s.RENDERBUFFER,it),s.framebufferRenderbuffer(s.FRAMEBUFFER,q,s.RENDERBUFFER,it)}}else{const G=R.texture.mipmaps;if(G&&G.length>0?e.bindFramebuffer(s.FRAMEBUFFER,y.__webglFramebuffer[0]):e.bindFramebuffer(s.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=s.createRenderbuffer(),de(y.__webglDepthbuffer,R,!1);else{const q=R.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,it=y.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,it),s.framebufferRenderbuffer(s.FRAMEBUFFER,q,s.RENDERBUFFER,it)}}e.bindFramebuffer(s.FRAMEBUFFER,null)}function Yt(R,y,O){const G=i.get(R);y!==void 0&&Tt(G.__webglFramebuffer,R,R.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),O!==void 0&&te(R)}function Ht(R){const y=R.texture,O=i.get(R),G=i.get(y);R.addEventListener("dispose",x);const q=R.textures,it=R.isWebGLCubeRenderTarget===!0,at=q.length>1;if(at||(G.__webglTexture===void 0&&(G.__webglTexture=s.createTexture()),G.__version=y.version,a.memory.textures++),it){O.__webglFramebuffer=[];for(let $=0;$<6;$++)if(y.mipmaps&&y.mipmaps.length>0){O.__webglFramebuffer[$]=[];for(let K=0;K<y.mipmaps.length;K++)O.__webglFramebuffer[$][K]=s.createFramebuffer()}else O.__webglFramebuffer[$]=s.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){O.__webglFramebuffer=[];for(let $=0;$<y.mipmaps.length;$++)O.__webglFramebuffer[$]=s.createFramebuffer()}else O.__webglFramebuffer=s.createFramebuffer();if(at)for(let $=0,K=q.length;$<K;$++){const ot=i.get(q[$]);ot.__webglTexture===void 0&&(ot.__webglTexture=s.createTexture(),a.memory.textures++)}if(R.samples>0&&xe(R)===!1){O.__webglMultisampledFramebuffer=s.createFramebuffer(),O.__webglColorRenderbuffer=[],e.bindFramebuffer(s.FRAMEBUFFER,O.__webglMultisampledFramebuffer);for(let $=0;$<q.length;$++){const K=q[$];O.__webglColorRenderbuffer[$]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,O.__webglColorRenderbuffer[$]);const ot=r.convert(K.format,K.colorSpace),St=r.convert(K.type),ut=M(K.internalFormat,ot,St,K.normalized,K.colorSpace,R.isXRRenderTarget===!0),lt=he(R);s.renderbufferStorageMultisample(s.RENDERBUFFER,lt,ut,R.width,R.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+$,s.RENDERBUFFER,O.__webglColorRenderbuffer[$])}s.bindRenderbuffer(s.RENDERBUFFER,null),R.depthBuffer&&(O.__webglDepthRenderbuffer=s.createRenderbuffer(),de(O.__webglDepthRenderbuffer,R,!0)),e.bindFramebuffer(s.FRAMEBUFFER,null)}}if(it){e.bindTexture(s.TEXTURE_CUBE_MAP,G.__webglTexture),qt(s.TEXTURE_CUBE_MAP,y);for(let $=0;$<6;$++)if(y.mipmaps&&y.mipmaps.length>0)for(let K=0;K<y.mipmaps.length;K++)Tt(O.__webglFramebuffer[$][K],R,y,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+$,K);else Tt(O.__webglFramebuffer[$],R,y,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+$,0);p(y)&&v(s.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(at){for(let $=0,K=q.length;$<K;$++){const ot=q[$],St=i.get(ot);let ut=s.TEXTURE_2D;(R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(ut=R.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(ut,St.__webglTexture),qt(ut,ot),Tt(O.__webglFramebuffer,R,ot,s.COLOR_ATTACHMENT0+$,ut,0),p(ot)&&v(ut)}e.unbindTexture()}else{let $=s.TEXTURE_2D;if((R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&($=R.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture($,G.__webglTexture),qt($,y),y.mipmaps&&y.mipmaps.length>0)for(let K=0;K<y.mipmaps.length;K++)Tt(O.__webglFramebuffer[K],R,y,s.COLOR_ATTACHMENT0,$,K);else Tt(O.__webglFramebuffer,R,y,s.COLOR_ATTACHMENT0,$,0);p(y)&&v($),e.unbindTexture()}R.depthBuffer&&te(R)}function ge(R){const y=R.textures;for(let O=0,G=y.length;O<G;O++){const q=y[O];if(p(q)){const it=E(R),at=i.get(q).__webglTexture;e.bindTexture(it,at),v(it),e.unbindTexture()}}}const ve=[],Te=[];function Pe(R){if(R.samples>0){if(xe(R)===!1){const y=R.textures,O=R.width,G=R.height;let q=s.COLOR_BUFFER_BIT;const it=R.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,at=i.get(R),$=y.length>1;if($)for(let ot=0;ot<y.length;ot++)e.bindFramebuffer(s.FRAMEBUFFER,at.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ot,s.RENDERBUFFER,null),e.bindFramebuffer(s.FRAMEBUFFER,at.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+ot,s.TEXTURE_2D,null,0);e.bindFramebuffer(s.READ_FRAMEBUFFER,at.__webglMultisampledFramebuffer);const K=R.texture.mipmaps;K&&K.length>0?e.bindFramebuffer(s.DRAW_FRAMEBUFFER,at.__webglFramebuffer[0]):e.bindFramebuffer(s.DRAW_FRAMEBUFFER,at.__webglFramebuffer);for(let ot=0;ot<y.length;ot++){if(R.resolveDepthBuffer&&(R.depthBuffer&&(q|=s.DEPTH_BUFFER_BIT),R.stencilBuffer&&R.resolveStencilBuffer&&(q|=s.STENCIL_BUFFER_BIT)),$){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,at.__webglColorRenderbuffer[ot]);const St=i.get(y[ot]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,St,0)}s.blitFramebuffer(0,0,O,G,0,0,O,G,q,s.NEAREST),l===!0&&(ve.length=0,Te.length=0,ve.push(s.COLOR_ATTACHMENT0+ot),R.depthBuffer&&R.resolveDepthBuffer===!1&&(ve.push(it),Te.push(it),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,Te)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,ve))}if(e.bindFramebuffer(s.READ_FRAMEBUFFER,null),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),$)for(let ot=0;ot<y.length;ot++){e.bindFramebuffer(s.FRAMEBUFFER,at.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ot,s.RENDERBUFFER,at.__webglColorRenderbuffer[ot]);const St=i.get(y[ot]).__webglTexture;e.bindFramebuffer(s.FRAMEBUFFER,at.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+ot,s.TEXTURE_2D,St,0)}e.bindFramebuffer(s.DRAW_FRAMEBUFFER,at.__webglMultisampledFramebuffer)}else if(R.depthBuffer&&R.resolveDepthBuffer===!1&&l){const y=R.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[y])}}}function he(R){return Math.min(n.maxSamples,R.samples)}function xe(R){const y=i.get(R);return R.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function L(R){const y=a.render.frame;u.get(R)!==y&&(u.set(R,y),R.update())}function We(R,y){const O=R.colorSpace,G=R.format,q=R.type;return R.isCompressedTexture===!0||R.isVideoTexture===!0||O!==Wa&&O!==_n&&(kt.getTransfer(O)===Kt?(G!==_i||q!==ei)&&Rt("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Gt("WebGLTextures: Unsupported texture color space:",O)),y}function Zt(R){return typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement?(h.width=R.naturalWidth||R.width,h.height=R.naturalHeight||R.height):typeof VideoFrame<"u"&&R instanceof VideoFrame?(h.width=R.displayWidth,h.height=R.displayHeight):(h.width=R.width,h.height=R.height),h}this.allocateTextureUnit=Y,this.resetTextureUnits=z,this.getTextureUnits=X,this.setTextureUnits=N,this.setTexture2D=Q,this.setTexture2DArray=tt,this.setTexture3D=nt,this.setTextureCube=ct,this.rebindTextures=Yt,this.setupRenderTarget=Ht,this.updateRenderTargetMipmap=ge,this.updateMultisampleRenderTarget=Pe,this.setupDepthRenderbuffer=te,this.setupFrameBufferTexture=Tt,this.useMultisampledRTT=xe,this.isReversedDepthBuffer=function(){return e.buffers.depth.getReversed()}}function S_(s,t){function e(i,n=_n){let r;const a=kt.getTransfer(n);if(i===ei)return s.UNSIGNED_BYTE;if(i===gh)return s.UNSIGNED_SHORT_4_4_4_4;if(i===xh)return s.UNSIGNED_SHORT_5_5_5_1;if(i===Qu)return s.UNSIGNED_INT_5_9_9_9_REV;if(i===ju)return s.UNSIGNED_INT_10F_11F_11F_REV;if(i===Ku)return s.BYTE;if(i===Ju)return s.SHORT;if(i===yr)return s.UNSIGNED_SHORT;if(i===mh)return s.INT;if(i===Fi)return s.UNSIGNED_INT;if(i===xi)return s.FLOAT;if(i===Qi)return s.HALF_FLOAT;if(i===td)return s.ALPHA;if(i===ed)return s.RGB;if(i===_i)return s.RGBA;if(i===ji)return s.DEPTH_COMPONENT;if(i===Vn)return s.DEPTH_STENCIL;if(i===_h)return s.RED;if(i===yh)return s.RED_INTEGER;if(i===Hn)return s.RG;if(i===Mh)return s.RG_INTEGER;if(i===vh)return s.RGBA_INTEGER;if(i===Da||i===Ia||i===La||i===Na)if(a===Kt)if(r=t.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(i===Da)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Ia)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===La)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Na)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=t.get("WEBGL_compressed_texture_s3tc"),r!==null){if(i===Da)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Ia)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===La)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Na)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Sl||i===bl||i===El||i===wl)if(r=t.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(i===Sl)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===bl)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===El)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===wl)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Tl||i===Al||i===Rl||i===Cl||i===Pl||i===Va||i===Dl)if(r=t.get("WEBGL_compressed_texture_etc"),r!==null){if(i===Tl||i===Al)return a===Kt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(i===Rl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(i===Cl)return r.COMPRESSED_R11_EAC;if(i===Pl)return r.COMPRESSED_SIGNED_R11_EAC;if(i===Va)return r.COMPRESSED_RG11_EAC;if(i===Dl)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===Il||i===Ll||i===Nl||i===Fl||i===Ul||i===Ol||i===zl||i===Bl||i===kl||i===Vl||i===Gl||i===Hl||i===Wl||i===Xl)if(r=t.get("WEBGL_compressed_texture_astc"),r!==null){if(i===Il)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Ll)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Nl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Fl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Ul)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===Ol)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===zl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===Bl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===kl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===Vl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===Gl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===Hl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===Wl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===Xl)return a===Kt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===ql||i===Yl||i===$l)if(r=t.get("EXT_texture_compression_bptc"),r!==null){if(i===ql)return a===Kt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===Yl)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===$l)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===Zl||i===Kl||i===Ga||i===Jl)if(r=t.get("EXT_texture_compression_rgtc"),r!==null){if(i===Zl)return r.COMPRESSED_RED_RGTC1_EXT;if(i===Kl)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Ga)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===Jl)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===Mr?s.UNSIGNED_INT_24_8:s[i]!==void 0?s[i]:null}return{convert:e}}const b_=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,E_=`
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

}`;class w_{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){const i=new gd(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,i=new hi({vertexShader:b_,fragmentShader:E_,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Me(new xd(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class T_ extends Tn{constructor(t,e){super();const i=this;let n=null,r=1,a=null,o="local-floor",l=1,h=null,u=null,d=null,c=null,f=null,g=null;const _=typeof XRWebGLBinding<"u",m=new w_,p={},v=e.getContextAttributes();let E=null,M=null;const T=[],b=[],A=new Pt;let x=null;const w=new ti;w.viewport=new me;const C=new ti;C.viewport=new me;const P=[w,C],D=new Np;let z=null,X=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(J){let rt=T[J];return rt===void 0&&(rt=new fo,T[J]=rt),rt.getTargetRaySpace()},this.getControllerGrip=function(J){let rt=T[J];return rt===void 0&&(rt=new fo,T[J]=rt),rt.getGripSpace()},this.getHand=function(J){let rt=T[J];return rt===void 0&&(rt=new fo,T[J]=rt),rt.getHandSpace()};function N(J){const rt=b.indexOf(J.inputSource);if(rt===-1)return;const et=T[rt];et!==void 0&&(et.update(J.inputSource,J.frame,h||a),et.dispatchEvent({type:J.type,data:J.inputSource}))}function Y(){n.removeEventListener("select",N),n.removeEventListener("selectstart",N),n.removeEventListener("selectend",N),n.removeEventListener("squeeze",N),n.removeEventListener("squeezestart",N),n.removeEventListener("squeezeend",N),n.removeEventListener("end",Y),n.removeEventListener("inputsourceschange",V);for(let J=0;J<T.length;J++){const rt=b[J];rt!==null&&(b[J]=null,T[J].disconnect(rt))}z=null,X=null,m.reset();for(const J in p)delete p[J];t.setRenderTarget(E),f=null,c=null,d=null,n=null,M=null,qt.stop(),i.isPresenting=!1,t.setPixelRatio(x),t.setSize(A.width,A.height,!1),i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(J){r=J,i.isPresenting===!0&&Rt("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(J){o=J,i.isPresenting===!0&&Rt("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return h||a},this.setReferenceSpace=function(J){h=J},this.getBaseLayer=function(){return c!==null?c:f},this.getBinding=function(){return d===null&&_&&(d=new XRWebGLBinding(n,e)),d},this.getFrame=function(){return g},this.getSession=function(){return n},this.setSession=async function(J){if(n=J,n!==null){if(E=t.getRenderTarget(),n.addEventListener("select",N),n.addEventListener("selectstart",N),n.addEventListener("selectend",N),n.addEventListener("squeeze",N),n.addEventListener("squeezestart",N),n.addEventListener("squeezeend",N),n.addEventListener("end",Y),n.addEventListener("inputsourceschange",V),v.xrCompatible!==!0&&await e.makeXRCompatible(),x=t.getPixelRatio(),t.getSize(A),_&&"createProjectionLayer"in XRWebGLBinding.prototype){let et=null,Ct=null,It=null;v.depth&&(It=v.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,et=v.stencil?Vn:ji,Ct=v.stencil?Mr:Fi);const Tt={colorFormat:e.RGBA8,depthFormat:It,scaleFactor:r};d=this.getBinding(),c=d.createProjectionLayer(Tt),n.updateRenderState({layers:[c]}),t.setPixelRatio(1),t.setSize(c.textureWidth,c.textureHeight,!1),M=new Li(c.textureWidth,c.textureHeight,{format:_i,type:ei,depthTexture:new Hs(c.textureWidth,c.textureHeight,Ct,void 0,void 0,void 0,void 0,void 0,void 0,et),stencilBuffer:v.stencil,colorSpace:t.outputColorSpace,samples:v.antialias?4:0,resolveDepthBuffer:c.ignoreDepthValues===!1,resolveStencilBuffer:c.ignoreDepthValues===!1})}else{const et={antialias:v.antialias,alpha:!0,depth:v.depth,stencil:v.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(n,e,et),n.updateRenderState({baseLayer:f}),t.setPixelRatio(1),t.setSize(f.framebufferWidth,f.framebufferHeight,!1),M=new Li(f.framebufferWidth,f.framebufferHeight,{format:_i,type:ei,colorSpace:t.outputColorSpace,stencilBuffer:v.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}M.isXRRenderTarget=!0,this.setFoveation(l),h=null,a=await n.requestReferenceSpace(o),qt.setContext(n),qt.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(n!==null)return n.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function V(J){for(let rt=0;rt<J.removed.length;rt++){const et=J.removed[rt],Ct=b.indexOf(et);Ct>=0&&(b[Ct]=null,T[Ct].disconnect(et))}for(let rt=0;rt<J.added.length;rt++){const et=J.added[rt];let Ct=b.indexOf(et);if(Ct===-1){for(let Tt=0;Tt<T.length;Tt++)if(Tt>=b.length){b.push(et),Ct=Tt;break}else if(b[Tt]===null){b[Tt]=et,Ct=Tt;break}if(Ct===-1)break}const It=T[Ct];It&&It.connect(et)}}const Q=new U,tt=new U;function nt(J,rt,et){Q.setFromMatrixPosition(rt.matrixWorld),tt.setFromMatrixPosition(et.matrixWorld);const Ct=Q.distanceTo(tt),It=rt.projectionMatrix.elements,Tt=et.projectionMatrix.elements,de=It[14]/(It[10]-1),Bt=It[14]/(It[10]+1),te=(It[9]+1)/It[5],Yt=(It[9]-1)/It[5],Ht=(It[8]-1)/It[0],ge=(Tt[8]+1)/Tt[0],ve=de*Ht,Te=de*ge,Pe=Ct/(-Ht+ge),he=Pe*-Ht;if(rt.matrixWorld.decompose(J.position,J.quaternion,J.scale),J.translateX(he),J.translateZ(Pe),J.matrixWorld.compose(J.position,J.quaternion,J.scale),J.matrixWorldInverse.copy(J.matrixWorld).invert(),It[10]===-1)J.projectionMatrix.copy(rt.projectionMatrix),J.projectionMatrixInverse.copy(rt.projectionMatrixInverse);else{const xe=de+Pe,L=Bt+Pe,We=ve-he,Zt=Te+(Ct-he),R=te*Bt/L*xe,y=Yt*Bt/L*xe;J.projectionMatrix.makePerspective(We,Zt,R,y,xe,L),J.projectionMatrixInverse.copy(J.projectionMatrix).invert()}}function ct(J,rt){rt===null?J.matrixWorld.copy(J.matrix):J.matrixWorld.multiplyMatrices(rt.matrixWorld,J.matrix),J.matrixWorldInverse.copy(J.matrixWorld).invert()}this.updateCamera=function(J){if(n===null)return;let rt=J.near,et=J.far;m.texture!==null&&(m.depthNear>0&&(rt=m.depthNear),m.depthFar>0&&(et=m.depthFar)),D.near=C.near=w.near=rt,D.far=C.far=w.far=et,(z!==D.near||X!==D.far)&&(n.updateRenderState({depthNear:D.near,depthFar:D.far}),z=D.near,X=D.far),D.layers.mask=J.layers.mask|6,w.layers.mask=D.layers.mask&-5,C.layers.mask=D.layers.mask&-3;const Ct=J.parent,It=D.cameras;ct(D,Ct);for(let Tt=0;Tt<It.length;Tt++)ct(It[Tt],Ct);It.length===2?nt(D,w,C):D.projectionMatrix.copy(w.projectionMatrix),_t(J,D,Ct)};function _t(J,rt,et){et===null?J.matrix.copy(rt.matrixWorld):(J.matrix.copy(et.matrixWorld),J.matrix.invert(),J.matrix.multiply(rt.matrixWorld)),J.matrix.decompose(J.position,J.quaternion,J.scale),J.updateMatrixWorld(!0),J.projectionMatrix.copy(rt.projectionMatrix),J.projectionMatrixInverse.copy(rt.projectionMatrixInverse),J.isPerspectiveCamera&&(J.fov=Sr*2*Math.atan(1/J.projectionMatrix.elements[5]),J.zoom=1)}this.getCamera=function(){return D},this.getFoveation=function(){if(!(c===null&&f===null))return l},this.setFoveation=function(J){l=J,c!==null&&(c.fixedFoveation=J),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=J)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(D)},this.getCameraTexture=function(J){return p[J]};let Xt=null;function le(J,rt){if(u=rt.getViewerPose(h||a),g=rt,u!==null){const et=u.views;f!==null&&(t.setRenderTargetFramebuffer(M,f.framebuffer),t.setRenderTarget(M));let Ct=!1;et.length!==D.cameras.length&&(D.cameras.length=0,Ct=!0);for(let Bt=0;Bt<et.length;Bt++){const te=et[Bt];let Yt=null;if(f!==null)Yt=f.getViewport(te);else{const ge=d.getViewSubImage(c,te);Yt=ge.viewport,Bt===0&&(t.setRenderTargetTextures(M,ge.colorTexture,ge.depthStencilTexture),t.setRenderTarget(M))}let Ht=P[Bt];Ht===void 0&&(Ht=new ti,Ht.layers.enable(Bt),Ht.viewport=new me,P[Bt]=Ht),Ht.matrix.fromArray(te.transform.matrix),Ht.matrix.decompose(Ht.position,Ht.quaternion,Ht.scale),Ht.projectionMatrix.fromArray(te.projectionMatrix),Ht.projectionMatrixInverse.copy(Ht.projectionMatrix).invert(),Ht.viewport.set(Yt.x,Yt.y,Yt.width,Yt.height),Bt===0&&(D.matrix.copy(Ht.matrix),D.matrix.decompose(D.position,D.quaternion,D.scale)),Ct===!0&&D.cameras.push(Ht)}const It=n.enabledFeatures;if(It&&It.includes("depth-sensing")&&n.depthUsage=="gpu-optimized"&&_){d=i.getBinding();const Bt=d.getDepthInformation(et[0]);Bt&&Bt.isValid&&Bt.texture&&m.init(Bt,n.renderState)}if(It&&It.includes("camera-access")&&_){t.state.unbindTexture(),d=i.getBinding();for(let Bt=0;Bt<et.length;Bt++){const te=et[Bt].camera;if(te){let Yt=p[te];Yt||(Yt=new gd,p[te]=Yt);const Ht=d.getCameraImage(te);Yt.sourceTexture=Ht}}}}for(let et=0;et<T.length;et++){const Ct=b[et],It=T[et];Ct!==null&&It!==void 0&&It.update(Ct,rt,h||a)}Xt&&Xt(J,rt),rt.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:rt}),g=null}const qt=new wd;qt.setAnimationLoop(le),this.setAnimationLoop=function(J){Xt=J},this.dispose=function(){}}}const A_=new oe,Id=new Ft;Id.set(-1,0,0,0,1,0,0,0,1);function R_(s,t){function e(m,p){m.matrixAutoUpdate===!0&&m.updateMatrix(),p.value.copy(m.matrix)}function i(m,p){p.color.getRGB(m.fogColor.value,Md(s)),p.isFog?(m.fogNear.value=p.near,m.fogFar.value=p.far):p.isFogExp2&&(m.fogDensity.value=p.density)}function n(m,p,v,E,M){p.isNodeMaterial?p.uniformsNeedUpdate=!1:p.isMeshBasicMaterial?r(m,p):p.isMeshLambertMaterial?(r(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshToonMaterial?(r(m,p),d(m,p)):p.isMeshPhongMaterial?(r(m,p),u(m,p),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)):p.isMeshStandardMaterial?(r(m,p),c(m,p),p.isMeshPhysicalMaterial&&f(m,p,M)):p.isMeshMatcapMaterial?(r(m,p),g(m,p)):p.isMeshDepthMaterial?r(m,p):p.isMeshDistanceMaterial?(r(m,p),_(m,p)):p.isMeshNormalMaterial?r(m,p):p.isLineBasicMaterial?(a(m,p),p.isLineDashedMaterial&&o(m,p)):p.isPointsMaterial?l(m,p,v,E):p.isSpriteMaterial?h(m,p):p.isShadowMaterial?(m.color.value.copy(p.color),m.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function r(m,p){m.opacity.value=p.opacity,p.color&&m.diffuse.value.copy(p.color),p.emissive&&m.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(m.map.value=p.map,e(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,e(p.alphaMap,m.alphaMapTransform)),p.bumpMap&&(m.bumpMap.value=p.bumpMap,e(p.bumpMap,m.bumpMapTransform),m.bumpScale.value=p.bumpScale,p.side===Le&&(m.bumpScale.value*=-1)),p.normalMap&&(m.normalMap.value=p.normalMap,e(p.normalMap,m.normalMapTransform),m.normalScale.value.copy(p.normalScale),p.side===Le&&m.normalScale.value.negate()),p.displacementMap&&(m.displacementMap.value=p.displacementMap,e(p.displacementMap,m.displacementMapTransform),m.displacementScale.value=p.displacementScale,m.displacementBias.value=p.displacementBias),p.emissiveMap&&(m.emissiveMap.value=p.emissiveMap,e(p.emissiveMap,m.emissiveMapTransform)),p.specularMap&&(m.specularMap.value=p.specularMap,e(p.specularMap,m.specularMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest);const v=t.get(p),E=v.envMap,M=v.envMapRotation;E&&(m.envMap.value=E,m.envMapRotation.value.setFromMatrix4(A_.makeRotationFromEuler(M)).transpose(),E.isCubeTexture&&E.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(Id),m.reflectivity.value=p.reflectivity,m.ior.value=p.ior,m.refractionRatio.value=p.refractionRatio),p.lightMap&&(m.lightMap.value=p.lightMap,m.lightMapIntensity.value=p.lightMapIntensity,e(p.lightMap,m.lightMapTransform)),p.aoMap&&(m.aoMap.value=p.aoMap,m.aoMapIntensity.value=p.aoMapIntensity,e(p.aoMap,m.aoMapTransform))}function a(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,p.map&&(m.map.value=p.map,e(p.map,m.mapTransform))}function o(m,p){m.dashSize.value=p.dashSize,m.totalSize.value=p.dashSize+p.gapSize,m.scale.value=p.scale}function l(m,p,v,E){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.size.value=p.size*v,m.scale.value=E*.5,p.map&&(m.map.value=p.map,e(p.map,m.uvTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,e(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function h(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.rotation.value=p.rotation,p.map&&(m.map.value=p.map,e(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,e(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function u(m,p){m.specular.value.copy(p.specular),m.shininess.value=Math.max(p.shininess,1e-4)}function d(m,p){p.gradientMap&&(m.gradientMap.value=p.gradientMap)}function c(m,p){m.metalness.value=p.metalness,p.metalnessMap&&(m.metalnessMap.value=p.metalnessMap,e(p.metalnessMap,m.metalnessMapTransform)),m.roughness.value=p.roughness,p.roughnessMap&&(m.roughnessMap.value=p.roughnessMap,e(p.roughnessMap,m.roughnessMapTransform)),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)}function f(m,p,v){m.ior.value=p.ior,p.sheen>0&&(m.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),m.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(m.sheenColorMap.value=p.sheenColorMap,e(p.sheenColorMap,m.sheenColorMapTransform)),p.sheenRoughnessMap&&(m.sheenRoughnessMap.value=p.sheenRoughnessMap,e(p.sheenRoughnessMap,m.sheenRoughnessMapTransform))),p.clearcoat>0&&(m.clearcoat.value=p.clearcoat,m.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(m.clearcoatMap.value=p.clearcoatMap,e(p.clearcoatMap,m.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,e(p.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(m.clearcoatNormalMap.value=p.clearcoatNormalMap,e(p.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Le&&m.clearcoatNormalScale.value.negate())),p.dispersion>0&&(m.dispersion.value=p.dispersion),p.iridescence>0&&(m.iridescence.value=p.iridescence,m.iridescenceIOR.value=p.iridescenceIOR,m.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(m.iridescenceMap.value=p.iridescenceMap,e(p.iridescenceMap,m.iridescenceMapTransform)),p.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=p.iridescenceThicknessMap,e(p.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),p.transmission>0&&(m.transmission.value=p.transmission,m.transmissionSamplerMap.value=v.texture,m.transmissionSamplerSize.value.set(v.width,v.height),p.transmissionMap&&(m.transmissionMap.value=p.transmissionMap,e(p.transmissionMap,m.transmissionMapTransform)),m.thickness.value=p.thickness,p.thicknessMap&&(m.thicknessMap.value=p.thicknessMap,e(p.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=p.attenuationDistance,m.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(m.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(m.anisotropyMap.value=p.anisotropyMap,e(p.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=p.specularIntensity,m.specularColor.value.copy(p.specularColor),p.specularColorMap&&(m.specularColorMap.value=p.specularColorMap,e(p.specularColorMap,m.specularColorMapTransform)),p.specularIntensityMap&&(m.specularIntensityMap.value=p.specularIntensityMap,e(p.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,p){p.matcap&&(m.matcap.value=p.matcap)}function _(m,p){const v=t.get(p).light;m.referencePosition.value.setFromMatrixPosition(v.matrixWorld),m.nearDistance.value=v.shadow.camera.near,m.farDistance.value=v.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:n}}function C_(s,t,e,i){let n={},r={},a=[];const o=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function l(M,T){const b=T.program;i.uniformBlockBinding(M,b)}function h(M,T){let b=n[M.id];b===void 0&&(m(M),b=u(M),n[M.id]=b,M.addEventListener("dispose",v));const A=T.program;i.updateUBOMapping(M,A);const x=t.render.frame;r[M.id]!==x&&(c(M),r[M.id]=x)}function u(M){const T=d();M.__bindingPointIndex=T;const b=s.createBuffer(),A=M.__size,x=M.usage;return s.bindBuffer(s.UNIFORM_BUFFER,b),s.bufferData(s.UNIFORM_BUFFER,A,x),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,T,b),b}function d(){for(let M=0;M<o;M++)if(a.indexOf(M)===-1)return a.push(M),M;return Gt("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function c(M){const T=n[M.id],b=M.uniforms,A=M.__cache;s.bindBuffer(s.UNIFORM_BUFFER,T);for(let x=0,w=b.length;x<w;x++){const C=b[x];if(Array.isArray(C))for(let P=0,D=C.length;P<D;P++)f(C[P],x,P,A);else f(C,x,0,A)}s.bindBuffer(s.UNIFORM_BUFFER,null)}function f(M,T,b,A){if(_(M,T,b,A)===!0){const x=M.__offset,w=M.value;if(Array.isArray(w)){let C=0;for(let P=0;P<w.length;P++){const D=w[P],z=p(D);g(D,M.__data,C),typeof D!="number"&&typeof D!="boolean"&&!D.isMatrix3&&!ArrayBuffer.isView(D)&&(C+=z.storage/Float32Array.BYTES_PER_ELEMENT)}}else g(w,M.__data,0);s.bufferSubData(s.UNIFORM_BUFFER,x,M.__data)}}function g(M,T,b){typeof M=="number"||typeof M=="boolean"?T[0]=M:M.isMatrix3?(T[0]=M.elements[0],T[1]=M.elements[1],T[2]=M.elements[2],T[3]=0,T[4]=M.elements[3],T[5]=M.elements[4],T[6]=M.elements[5],T[7]=0,T[8]=M.elements[6],T[9]=M.elements[7],T[10]=M.elements[8],T[11]=0):ArrayBuffer.isView(M)?T.set(new M.constructor(M.buffer,M.byteOffset,T.length)):M.toArray(T,b)}function _(M,T,b,A){const x=M.value,w=T+"_"+b;if(A[w]===void 0)return typeof x=="number"||typeof x=="boolean"?A[w]=x:ArrayBuffer.isView(x)?A[w]=x.slice():A[w]=x.clone(),!0;{const C=A[w];if(typeof x=="number"||typeof x=="boolean"){if(C!==x)return A[w]=x,!0}else{if(ArrayBuffer.isView(x))return!0;if(C.equals(x)===!1)return C.copy(x),!0}}return!1}function m(M){const T=M.uniforms;let b=0;const A=16;for(let w=0,C=T.length;w<C;w++){const P=Array.isArray(T[w])?T[w]:[T[w]];for(let D=0,z=P.length;D<z;D++){const X=P[D],N=Array.isArray(X.value)?X.value:[X.value];for(let Y=0,V=N.length;Y<V;Y++){const Q=N[Y],tt=p(Q),nt=b%A,ct=nt%tt.boundary,_t=nt+ct;b+=ct,_t!==0&&A-_t<tt.storage&&(b+=A-_t),X.__data=new Float32Array(tt.storage/Float32Array.BYTES_PER_ELEMENT),X.__offset=b,b+=tt.storage}}}const x=b%A;return x>0&&(b+=A-x),M.__size=b,M.__cache={},this}function p(M){const T={boundary:0,storage:0};return typeof M=="number"||typeof M=="boolean"?(T.boundary=4,T.storage=4):M.isVector2?(T.boundary=8,T.storage=8):M.isVector3||M.isColor?(T.boundary=16,T.storage=12):M.isVector4?(T.boundary=16,T.storage=16):M.isMatrix3?(T.boundary=48,T.storage=48):M.isMatrix4?(T.boundary=64,T.storage=64):M.isTexture?Rt("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(M)?(T.boundary=16,T.storage=M.byteLength):Rt("WebGLRenderer: Unsupported uniform value type.",M),T}function v(M){const T=M.target;T.removeEventListener("dispose",v);const b=a.indexOf(T.__bindingPointIndex);a.splice(b,1),s.deleteBuffer(n[T.id]),delete n[T.id],delete r[T.id]}function E(){for(const M in n)s.deleteBuffer(n[M]);a=[],n={},r={}}return{bind:l,update:h,dispose:E}}const P_=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]);let Ai=null;function D_(){return Ai===null&&(Ai=new pd(P_,16,16,Hn,Qi),Ai.name="DFG_LUT",Ai.minFilter=Be,Ai.magFilter=Be,Ai.wrapS=$i,Ai.wrapT=$i,Ai.generateMipmaps=!1,Ai.needsUpdate=!0),Ai}class I_{constructor(t={}){const{canvas:e=If(),context:i=null,depth:n=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:h=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:d=!1,reversedDepthBuffer:c=!1,outputBufferType:f=ei}=t;this.isWebGLRenderer=!0;let g;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");g=i.getContextAttributes().alpha}else g=a;const _=f,m=new Set([vh,Mh,yh]),p=new Set([ei,Fi,yr,Mr,gh,xh]),v=new Uint32Array(4),E=new Int32Array(4),M=new U;let T=null,b=null;const A=[],x=[];let w=null;this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=yi,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const C=this;let P=!1,D=null,z=null,X=null,N=null;this._outputColorSpace=je;let Y=0,V=0,Q=null,tt=-1,nt=null;const ct=new me,_t=new me;let Xt=null;const le=new Dt(0);let qt=0,J=e.width,rt=e.height,et=1,Ct=null,It=null;const Tt=new me(0,0,J,rt),de=new me(0,0,J,rt);let Bt=!1;const te=new Ph;let Yt=!1,Ht=!1;const ge=new oe,ve=new U,Te=new me,Pe={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let he=!1;function xe(){return Q===null?et:1}let L=i;function We(S,F){return e.getContext(S,F)}try{const S={alpha:!0,depth:n,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:h,powerPreference:u,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${lh}`),e.addEventListener("webglcontextlost",ce,!1),e.addEventListener("webglcontextrestored",ne,!1),e.addEventListener("webglcontextcreationerror",bi,!1),L===null){const F="webgl2";if(L=We(F,S),L===null)throw We(F)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}}catch(S){throw Gt("WebGLRenderer: "+S.message),S}let Zt,R,y,O,G,q,it,at,$,K,ot,St,ut,lt,wt,At,Lt,I,st,Z,ht,mt,j;function vt(){Zt=new Dg(L),Zt.init(),ht=new S_(L,Zt),R=new bg(L,Zt,t,ht),y=new M_(L,Zt),R.reversedDepthBuffer&&c&&y.buffers.depth.setReversed(!0),z=L.createFramebuffer(),X=L.createFramebuffer(),N=L.createFramebuffer(),O=new Ng(L),G=new a_,q=new v_(L,Zt,y,G,R,ht,O),it=new Pg(C),at=new zp(L),mt=new vg(L,at),$=new Ig(L,at,O,mt),K=new Ug(L,$,at,mt,O),I=new Fg(L,R,q),wt=new Eg(G),ot=new r_(C,it,Zt,R,mt,wt),St=new R_(C,G),ut=new l_,lt=new p_(Zt),Lt=new Mg(C,it,y,K,g,l),At=new y_(C,K,R),j=new C_(L,O,R,y),st=new Sg(L,Zt,O),Z=new Lg(L,Zt,O),O.programs=ot.programs,C.capabilities=R,C.extensions=Zt,C.properties=G,C.renderLists=ut,C.shadowMap=At,C.state=y,C.info=O}vt(),_!==ei&&(w=new zg(_,e.width,e.height,o,n,r));const yt=new T_(C,L);this.xr=yt,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){const S=Zt.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){const S=Zt.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return et},this.setPixelRatio=function(S){S!==void 0&&(et=S,this.setSize(J,rt,!1))},this.getSize=function(S){return S.set(J,rt)},this.setSize=function(S,F,H=!0){if(yt.isPresenting){Rt("WebGLRenderer: Can't change size while VR device is presenting.");return}J=S,rt=F,e.width=Math.floor(S*et),e.height=Math.floor(F*et),H===!0&&(e.style.width=S+"px",e.style.height=F+"px"),w!==null&&w.setSize(e.width,e.height),this.setViewport(0,0,S,F)},this.getDrawingBufferSize=function(S){return S.set(J*et,rt*et).floor()},this.setDrawingBufferSize=function(S,F,H){J=S,rt=F,et=H,e.width=Math.floor(S*H),e.height=Math.floor(F*H),this.setViewport(0,0,S,F)},this.setEffects=function(S){if(_===ei){Gt("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(S){for(let F=0;F<S.length;F++)if(S[F].isOutputPass===!0){Rt("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}w.setEffects(S||[])},this.getCurrentViewport=function(S){return S.copy(ct)},this.getViewport=function(S){return S.copy(Tt)},this.setViewport=function(S,F,H,B){S.isVector4?Tt.set(S.x,S.y,S.z,S.w):Tt.set(S,F,H,B),y.viewport(ct.copy(Tt).multiplyScalar(et).round())},this.getScissor=function(S){return S.copy(de)},this.setScissor=function(S,F,H,B){S.isVector4?de.set(S.x,S.y,S.z,S.w):de.set(S,F,H,B),y.scissor(_t.copy(de).multiplyScalar(et).round())},this.getScissorTest=function(){return Bt},this.setScissorTest=function(S){y.setScissorTest(Bt=S)},this.setOpaqueSort=function(S){Ct=S},this.setTransparentSort=function(S){It=S},this.getClearColor=function(S){return S.copy(Lt.getClearColor())},this.setClearColor=function(){Lt.setClearColor(...arguments)},this.getClearAlpha=function(){return Lt.getClearAlpha()},this.setClearAlpha=function(){Lt.setClearAlpha(...arguments)},this.clear=function(S=!0,F=!0,H=!0){let B=0;if(S){let k=!1;if(Q!==null){const pt=Q.texture.format;k=m.has(pt)}if(k){const pt=Q.texture.type,xt=p.has(pt),ft=Lt.getClearColor(),Mt=Lt.getClearAlpha(),bt=ft.r,Nt=ft.g,Ot=ft.b;xt?(v[0]=bt,v[1]=Nt,v[2]=Ot,v[3]=Mt,L.clearBufferuiv(L.COLOR,0,v)):(E[0]=bt,E[1]=Nt,E[2]=Ot,E[3]=Mt,L.clearBufferiv(L.COLOR,0,E))}else B|=L.COLOR_BUFFER_BIT}F&&(B|=L.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),H&&(B|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),B!==0&&L.clear(B)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(S){S.setRenderer(this),D=S},this.dispose=function(){e.removeEventListener("webglcontextlost",ce,!1),e.removeEventListener("webglcontextrestored",ne,!1),e.removeEventListener("webglcontextcreationerror",bi,!1),Lt.dispose(),ut.dispose(),lt.dispose(),G.dispose(),it.dispose(),K.dispose(),mt.dispose(),j.dispose(),ot.dispose(),yt.dispose(),yt.removeEventListener("sessionstart",Vh),yt.removeEventListener("sessionend",Gh),Rn.stop()};function ce(S){S.preventDefault(),nc("WebGLRenderer: Context Lost."),P=!0}function ne(){nc("WebGLRenderer: Context Restored."),P=!1;const S=O.autoReset,F=At.enabled,H=At.autoUpdate,B=At.needsUpdate,k=At.type;vt(),O.autoReset=S,At.enabled=F,At.autoUpdate=H,At.needsUpdate=B,At.type=k}function bi(S){Gt("WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function Ei(S){const F=S.target;F.removeEventListener("dispose",Ei),qd(F)}function qd(S){Yd(S),G.remove(S)}function Yd(S){const F=G.get(S).programs;F!==void 0&&(F.forEach(function(H){ot.releaseProgram(H)}),S.isShaderMaterial&&ot.releaseShaderCache(S))}this.renderBufferDirect=function(S,F,H,B,k,pt){F===null&&(F=Pe);const xt=k.isMesh&&k.matrixWorld.determinantAffine()<0,ft=Kd(S,F,H,B,k);y.setMaterial(B,xt);let Mt=H.index,bt=1;if(B.wireframe===!0){if(Mt=$.getWireframeAttribute(H),Mt===void 0)return;bt=2}const Nt=H.drawRange,Ot=H.attributes.position;let Et=Nt.start*bt,Jt=(Nt.start+Nt.count)*bt;pt!==null&&(Et=Math.max(Et,pt.start*bt),Jt=Math.min(Jt,(pt.start+pt.count)*bt)),Mt!==null?(Et=Math.max(Et,0),Jt=Math.min(Jt,Mt.count)):Ot!=null&&(Et=Math.max(Et,0),Jt=Math.min(Jt,Ot.count));const fe=Jt-Et;if(fe<0||fe===1/0)return;mt.setup(k,B,ft,H,Mt);let ue,ee=st;if(Mt!==null&&(ue=at.get(Mt),ee=Z,ee.setIndex(ue)),k.isMesh)B.wireframe===!0?(y.setLineWidth(B.wireframeLinewidth*xe()),ee.setMode(L.LINES)):ee.setMode(L.TRIANGLES);else if(k.isLine){let Ne=B.linewidth;Ne===void 0&&(Ne=1),y.setLineWidth(Ne*xe()),k.isLineSegments?ee.setMode(L.LINES):k.isLineLoop?ee.setMode(L.LINE_LOOP):ee.setMode(L.LINE_STRIP)}else k.isPoints?ee.setMode(L.POINTS):k.isSprite&&ee.setMode(L.TRIANGLES);if(k.isBatchedMesh)if(Zt.get("WEBGL_multi_draw"))ee.renderMultiDraw(k._multiDrawStarts,k._multiDrawCounts,k._multiDrawCount);else{const Ne=k._multiDrawStarts,gt=k._multiDrawCounts,$e=k._multiDrawCount,Wt=Mt?at.get(Mt).bytesPerElement:1,ni=G.get(B).currentProgram.getUniforms();for(let wi=0;wi<$e;wi++)ni.setValue(L,"_gl_DrawID",wi),ee.render(Ne[wi]/Wt,gt[wi])}else if(k.isInstancedMesh)ee.renderInstances(Et,fe,k.count);else if(H.isInstancedBufferGeometry){const Ne=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,gt=Math.min(H.instanceCount,Ne);ee.renderInstances(Et,fe,gt)}else ee.render(Et,fe)};function kh(S,F,H){S.transparent===!0&&S.side===Yi&&S.forceSinglePass===!1?(S.side=Le,S.needsUpdate=!0,Dr(S,F,H),S.side=bn,S.needsUpdate=!0,Dr(S,F,H),S.side=Yi):Dr(S,F,H)}this.compile=function(S,F,H=null){H===null&&(H=S),b=lt.get(H),b.init(F),x.push(b),H.traverseVisible(function(k){k.isLight&&k.layers.test(F.layers)&&(b.pushLight(k),k.castShadow&&b.pushShadow(k))}),S!==H&&S.traverseVisible(function(k){k.isLight&&k.layers.test(F.layers)&&(b.pushLight(k),k.castShadow&&b.pushShadow(k))}),b.setupLights();const B=new Set;return S.traverse(function(k){if(!(k.isMesh||k.isPoints||k.isLine||k.isSprite))return;const pt=k.material;if(pt)if(Array.isArray(pt))for(let xt=0;xt<pt.length;xt++){const ft=pt[xt];kh(ft,H,k),B.add(ft)}else kh(pt,H,k),B.add(pt)}),b=x.pop(),B},this.compileAsync=function(S,F,H=null){const B=this.compile(S,F,H);return new Promise(k=>{function pt(){if(B.forEach(function(xt){G.get(xt).currentProgram.isReady()&&B.delete(xt)}),B.size===0){k(S);return}setTimeout(pt,10)}Zt.get("KHR_parallel_shader_compile")!==null?pt():setTimeout(pt,10)})};let no=null;function $d(S){no&&no(S)}function Vh(){Rn.stop()}function Gh(){Rn.start()}const Rn=new wd;Rn.setAnimationLoop($d),typeof self<"u"&&Rn.setContext(self),this.setAnimationLoop=function(S){no=S,yt.setAnimationLoop(S),S===null?Rn.stop():Rn.start()},yt.addEventListener("sessionstart",Vh),yt.addEventListener("sessionend",Gh),this.render=function(S,F){if(F!==void 0&&F.isCamera!==!0){Gt("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;D!==null&&D.renderStart(S,F);const H=yt.enabled===!0&&yt.isPresenting===!0,B=w!==null&&(Q===null||H)&&w.begin(C,Q);if(S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),F.parent===null&&F.matrixWorldAutoUpdate===!0&&F.updateMatrixWorld(),yt.enabled===!0&&yt.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(yt.cameraAutoUpdate===!0&&yt.updateCamera(F),F=yt.getCamera()),S.isScene===!0&&S.onBeforeRender(C,S,F,Q),b=lt.get(S,x.length),b.init(F),b.state.textureUnits=q.getTextureUnits(),x.push(b),ge.multiplyMatrices(F.projectionMatrix,F.matrixWorldInverse),te.setFromProjectionMatrix(ge,Di,F.reversedDepth),Ht=this.localClippingEnabled,Yt=wt.init(this.clippingPlanes,Ht),T=ut.get(S,A.length),T.init(),A.push(T),yt.enabled===!0&&yt.isPresenting===!0){const xt=C.xr.getDepthSensingMesh();xt!==null&&so(xt,F,-1/0,C.sortObjects)}so(S,F,0,C.sortObjects),T.finish(),C.sortObjects===!0&&T.sort(Ct,It,F.reversedDepth),he=yt.enabled===!1||yt.isPresenting===!1||yt.hasDepthSensing()===!1,he&&Lt.addToRenderList(T,S),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),Yt===!0&&wt.beginShadows();const k=b.state.shadowsArray;if(At.render(k,S,F),Yt===!0&&wt.endShadows(),(B&&w.hasRenderPass())===!1){const xt=T.opaque,ft=T.transmissive;if(b.setupLights(),F.isArrayCamera){const Mt=F.cameras;if(ft.length>0)for(let bt=0,Nt=Mt.length;bt<Nt;bt++){const Ot=Mt[bt];Wh(xt,ft,S,Ot)}he&&Lt.render(S);for(let bt=0,Nt=Mt.length;bt<Nt;bt++){const Ot=Mt[bt];Hh(T,S,Ot,Ot.viewport)}}else ft.length>0&&Wh(xt,ft,S,F),he&&Lt.render(S),Hh(T,S,F)}Q!==null&&V===0&&(q.updateMultisampleRenderTarget(Q),q.updateRenderTargetMipmap(Q)),B&&w.end(C),S.isScene===!0&&S.onAfterRender(C,S,F),mt.resetDefaultState(),tt=-1,nt=null,x.pop(),x.length>0?(b=x[x.length-1],q.setTextureUnits(b.state.textureUnits),Yt===!0&&wt.setGlobalState(C.clippingPlanes,b.state.camera)):b=null,A.pop(),A.length>0?T=A[A.length-1]:T=null,D!==null&&D.renderEnd()};function so(S,F,H,B){if(S.visible===!1)return;if(S.layers.test(F.layers)){if(S.isGroup)H=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(F);else if(S.isLightProbeGrid)b.pushLightProbeGrid(S);else if(S.isLight)b.pushLight(S),S.castShadow&&b.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||te.intersectsSprite(S)){B&&Te.setFromMatrixPosition(S.matrixWorld).applyMatrix4(ge);const xt=K.update(S),ft=S.material;ft.visible&&T.push(S,xt,ft,H,Te.z,null)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||te.intersectsObject(S))){const xt=K.update(S),ft=S.material;if(B&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),Te.copy(S.boundingSphere.center)):(xt.boundingSphere===null&&xt.computeBoundingSphere(),Te.copy(xt.boundingSphere.center)),Te.applyMatrix4(S.matrixWorld).applyMatrix4(ge)),Array.isArray(ft)){const Mt=xt.groups;for(let bt=0,Nt=Mt.length;bt<Nt;bt++){const Ot=Mt[bt],Et=ft[Ot.materialIndex];Et&&Et.visible&&T.push(S,xt,Et,H,Te.z,Ot)}}else ft.visible&&T.push(S,xt,ft,H,Te.z,null)}}const pt=S.children;for(let xt=0,ft=pt.length;xt<ft;xt++)so(pt[xt],F,H,B)}function Hh(S,F,H,B){const{opaque:k,transmissive:pt,transparent:xt}=S;b.setupLightsView(H),Yt===!0&&wt.setGlobalState(C.clippingPlanes,H),B&&y.viewport(ct.copy(B)),k.length>0&&Pr(k,F,H),pt.length>0&&Pr(pt,F,H),xt.length>0&&Pr(xt,F,H),y.buffers.depth.setTest(!0),y.buffers.depth.setMask(!0),y.buffers.color.setMask(!0),y.setPolygonOffset(!1)}function Wh(S,F,H,B){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;if(b.state.transmissionRenderTarget[B.id]===void 0){const Et=Zt.has("EXT_color_buffer_half_float")||Zt.has("EXT_color_buffer_float");b.state.transmissionRenderTarget[B.id]=new Li(1,1,{generateMipmaps:!0,type:Et?Qi:ei,minFilter:kn,samples:Math.max(4,R.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:kt.workingColorSpace})}const pt=b.state.transmissionRenderTarget[B.id],xt=B.viewport||ct;pt.setSize(xt.z*C.transmissionResolutionScale,xt.w*C.transmissionResolutionScale);const ft=C.getRenderTarget(),Mt=C.getActiveCubeFace(),bt=C.getActiveMipmapLevel();C.setRenderTarget(pt),C.getClearColor(le),qt=C.getClearAlpha(),qt<1&&C.setClearColor(16777215,.5),C.clear(),he&&Lt.render(H);const Nt=C.toneMapping;C.toneMapping=yi;const Ot=B.viewport;if(B.viewport!==void 0&&(B.viewport=void 0),b.setupLightsView(B),Yt===!0&&wt.setGlobalState(C.clippingPlanes,B),Pr(S,H,B),q.updateMultisampleRenderTarget(pt),q.updateRenderTargetMipmap(pt),Zt.has("WEBGL_multisampled_render_to_texture")===!1){let Et=!1;for(let Jt=0,fe=F.length;Jt<fe;Jt++){const ue=F[Jt],{object:ee,geometry:Ne,material:gt,group:$e}=ue;if(gt.side===Yi&&ee.layers.test(B.layers)){const Wt=gt.side;gt.side=Le,gt.needsUpdate=!0,Xh(ee,H,B,Ne,gt,$e),gt.side=Wt,gt.needsUpdate=!0,Et=!0}}Et===!0&&(q.updateMultisampleRenderTarget(pt),q.updateRenderTargetMipmap(pt))}C.setRenderTarget(ft,Mt,bt),C.setClearColor(le,qt),Ot!==void 0&&(B.viewport=Ot),C.toneMapping=Nt}function Pr(S,F,H){const B=F.isScene===!0?F.overrideMaterial:null;for(let k=0,pt=S.length;k<pt;k++){const xt=S[k],{object:ft,geometry:Mt,group:bt}=xt;let Nt=xt.material;Nt.allowOverride===!0&&B!==null&&(Nt=B),ft.layers.test(H.layers)&&Xh(ft,F,H,Mt,Nt,bt)}}function Xh(S,F,H,B,k,pt){S.onBeforeRender(C,F,H,B,k,pt),S.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),k.onBeforeRender(C,F,H,B,S,pt),k.transparent===!0&&k.side===Yi&&k.forceSinglePass===!1?(k.side=Le,k.needsUpdate=!0,C.renderBufferDirect(H,F,B,k,S,pt),k.side=bn,k.needsUpdate=!0,C.renderBufferDirect(H,F,B,k,S,pt),k.side=Yi):C.renderBufferDirect(H,F,B,k,S,pt),S.onAfterRender(C,F,H,B,k,pt)}function Dr(S,F,H){F.isScene!==!0&&(F=Pe);const B=G.get(S),k=b.state.lights,pt=b.state.shadowsArray,xt=k.state.version,ft=ot.getParameters(S,k.state,pt,F,H,b.state.lightProbeGridArray),Mt=ot.getProgramCacheKey(ft);let bt=B.programs;B.environment=S.isMeshStandardMaterial||S.isMeshLambertMaterial||S.isMeshPhongMaterial?F.environment:null,B.fog=F.fog;const Nt=S.isMeshStandardMaterial||S.isMeshLambertMaterial&&!S.envMap||S.isMeshPhongMaterial&&!S.envMap;B.envMap=it.get(S.envMap||B.environment,Nt),B.envMapRotation=B.environment!==null&&S.envMap===null?F.environmentRotation:S.envMapRotation,bt===void 0&&(S.addEventListener("dispose",Ei),bt=new Map,B.programs=bt);let Ot=bt.get(Mt);if(Ot!==void 0){if(B.currentProgram===Ot&&B.lightsStateVersion===xt)return Yh(S,ft),Ot}else ft.uniforms=ot.getUniforms(S),D!==null&&S.isNodeMaterial&&D.build(S,H,ft),S.onBeforeCompile(ft,C),Ot=ot.acquireProgram(ft,Mt),bt.set(Mt,Ot),B.uniforms=ft.uniforms;const Et=B.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(Et.clippingPlanes=wt.uniform),Yh(S,ft),B.needsLights=Qd(S),B.lightsStateVersion=xt,B.needsLights&&(Et.ambientLightColor.value=k.state.ambient,Et.lightProbe.value=k.state.probe,Et.directionalLights.value=k.state.directional,Et.directionalLightShadows.value=k.state.directionalShadow,Et.spotLights.value=k.state.spot,Et.spotLightShadows.value=k.state.spotShadow,Et.rectAreaLights.value=k.state.rectArea,Et.ltc_1.value=k.state.rectAreaLTC1,Et.ltc_2.value=k.state.rectAreaLTC2,Et.pointLights.value=k.state.point,Et.pointLightShadows.value=k.state.pointShadow,Et.hemisphereLights.value=k.state.hemi,Et.directionalShadowMatrix.value=k.state.directionalShadowMatrix,Et.spotLightMatrix.value=k.state.spotLightMatrix,Et.spotLightMap.value=k.state.spotLightMap,Et.pointShadowMatrix.value=k.state.pointShadowMatrix),B.lightProbeGrid=b.state.lightProbeGridArray.length>0,B.currentProgram=Ot,B.uniformsList=null,Ot}function qh(S){if(S.uniformsList===null){const F=S.currentProgram.getUniforms();S.uniformsList=za.seqWithValue(F.seq,S.uniforms)}return S.uniformsList}function Yh(S,F){const H=G.get(S);H.outputColorSpace=F.outputColorSpace,H.batching=F.batching,H.batchingColor=F.batchingColor,H.instancing=F.instancing,H.instancingColor=F.instancingColor,H.instancingMorph=F.instancingMorph,H.skinning=F.skinning,H.morphTargets=F.morphTargets,H.morphNormals=F.morphNormals,H.morphColors=F.morphColors,H.morphTargetsCount=F.morphTargetsCount,H.numClippingPlanes=F.numClippingPlanes,H.numIntersection=F.numClipIntersection,H.vertexAlphas=F.vertexAlphas,H.vertexTangents=F.vertexTangents,H.toneMapping=F.toneMapping}function Zd(S,F){if(S.length===0)return null;if(S.length===1)return S[0].texture!==null?S[0]:null;M.setFromMatrixPosition(F.matrixWorld);for(let H=0,B=S.length;H<B;H++){const k=S[H];if(k.texture!==null&&k.boundingBox.containsPoint(M))return k}return null}function Kd(S,F,H,B,k){F.isScene!==!0&&(F=Pe),q.resetTextureUnits();const pt=F.fog,xt=B.isMeshStandardMaterial||B.isMeshLambertMaterial||B.isMeshPhongMaterial?F.environment:null,ft=Q===null?C.outputColorSpace:Q.isXRRenderTarget===!0?Q.texture.colorSpace:kt.workingColorSpace,Mt=B.isMeshStandardMaterial||B.isMeshLambertMaterial&&!B.envMap||B.isMeshPhongMaterial&&!B.envMap,bt=it.get(B.envMap||xt,Mt),Nt=B.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,Ot=!!H.attributes.tangent&&(!!B.normalMap||B.anisotropy>0),Et=!!H.morphAttributes.position,Jt=!!H.morphAttributes.normal,fe=!!H.morphAttributes.color;let ue=yi;B.toneMapped&&(Q===null||Q.isXRRenderTarget===!0)&&(ue=C.toneMapping);const ee=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,Ne=ee!==void 0?ee.length:0,gt=G.get(B),$e=b.state.lights;if(Yt===!0&&(Ht===!0||S!==nt)){const se=S===nt&&B.id===tt;wt.setState(B,S,se)}let Wt=!1;B.version===gt.__version?(gt.needsLights&&gt.lightsStateVersion!==$e.state.version||gt.outputColorSpace!==ft||k.isBatchedMesh&&gt.batching===!1||!k.isBatchedMesh&&gt.batching===!0||k.isBatchedMesh&&gt.batchingColor===!0&&k.colorTexture===null||k.isBatchedMesh&&gt.batchingColor===!1&&k.colorTexture!==null||k.isInstancedMesh&&gt.instancing===!1||!k.isInstancedMesh&&gt.instancing===!0||k.isSkinnedMesh&&gt.skinning===!1||!k.isSkinnedMesh&&gt.skinning===!0||k.isInstancedMesh&&gt.instancingColor===!0&&k.instanceColor===null||k.isInstancedMesh&&gt.instancingColor===!1&&k.instanceColor!==null||k.isInstancedMesh&&gt.instancingMorph===!0&&k.morphTexture===null||k.isInstancedMesh&&gt.instancingMorph===!1&&k.morphTexture!==null||gt.envMap!==bt||B.fog===!0&&gt.fog!==pt||gt.numClippingPlanes!==void 0&&(gt.numClippingPlanes!==wt.numPlanes||gt.numIntersection!==wt.numIntersection)||gt.vertexAlphas!==Nt||gt.vertexTangents!==Ot||gt.morphTargets!==Et||gt.morphNormals!==Jt||gt.morphColors!==fe||gt.toneMapping!==ue||gt.morphTargetsCount!==Ne||!!gt.lightProbeGrid!=b.state.lightProbeGridArray.length>0)&&(Wt=!0):(Wt=!0,gt.__version=B.version);let ni=gt.currentProgram;Wt===!0&&(ni=Dr(B,F,k),D&&B.isNodeMaterial&&D.onUpdateProgram(B,ni,gt));let wi=!1,en=!1,Yn=!1;const ie=ni.getUniforms(),pe=gt.uniforms;if(y.useProgram(ni.program)&&(wi=!0,en=!0,Yn=!0),B.id!==tt&&(tt=B.id,en=!0),gt.needsLights){const se=Zd(b.state.lightProbeGridArray,k);gt.lightProbeGrid!==se&&(gt.lightProbeGrid=se,en=!0)}if(wi||nt!==S){y.buffers.depth.getReversed()&&S.reversedDepth!==!0&&(S._reversedDepth=!0,S.updateProjectionMatrix()),ie.setValue(L,"projectionMatrix",S.projectionMatrix),ie.setValue(L,"viewMatrix",S.matrixWorldInverse);const sn=ie.map.cameraPosition;sn!==void 0&&sn.setValue(L,ve.setFromMatrixPosition(S.matrixWorld)),R.logarithmicDepthBuffer&&ie.setValue(L,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(B.isMeshPhongMaterial||B.isMeshToonMaterial||B.isMeshLambertMaterial||B.isMeshBasicMaterial||B.isMeshStandardMaterial||B.isShaderMaterial)&&ie.setValue(L,"isOrthographic",S.isOrthographicCamera===!0),nt!==S&&(nt=S,en=!0,Yn=!0)}if(gt.needsLights&&($e.state.directionalShadowMap.length>0&&ie.setValue(L,"directionalShadowMap",$e.state.directionalShadowMap,q),$e.state.spotShadowMap.length>0&&ie.setValue(L,"spotShadowMap",$e.state.spotShadowMap,q),$e.state.pointShadowMap.length>0&&ie.setValue(L,"pointShadowMap",$e.state.pointShadowMap,q)),k.isSkinnedMesh){ie.setOptional(L,k,"bindMatrix"),ie.setOptional(L,k,"bindMatrixInverse");const se=k.skeleton;se&&(se.boneTexture===null&&se.computeBoneTexture(),ie.setValue(L,"boneTexture",se.boneTexture,q))}k.isBatchedMesh&&(ie.setOptional(L,k,"batchingTexture"),ie.setValue(L,"batchingTexture",k._matricesTexture,q),ie.setOptional(L,k,"batchingIdTexture"),ie.setValue(L,"batchingIdTexture",k._indirectTexture,q),ie.setOptional(L,k,"batchingColorTexture"),k._colorsTexture!==null&&ie.setValue(L,"batchingColorTexture",k._colorsTexture,q));const nn=H.morphAttributes;if((nn.position!==void 0||nn.normal!==void 0||nn.color!==void 0)&&I.update(k,H,ni),(en||gt.receiveShadow!==k.receiveShadow)&&(gt.receiveShadow=k.receiveShadow,ie.setValue(L,"receiveShadow",k.receiveShadow)),(B.isMeshStandardMaterial||B.isMeshLambertMaterial||B.isMeshPhongMaterial)&&B.envMap===null&&F.environment!==null&&(pe.envMapIntensity.value=F.environmentIntensity),pe.dfgLUT!==void 0&&(pe.dfgLUT.value=D_()),en){if(ie.setValue(L,"toneMappingExposure",C.toneMappingExposure),gt.needsLights&&Jd(pe,Yn),pt&&B.fog===!0&&St.refreshFogUniforms(pe,pt),St.refreshMaterialUniforms(pe,B,et,rt,b.state.transmissionRenderTarget[S.id]),gt.needsLights&&gt.lightProbeGrid){const se=gt.lightProbeGrid;pe.probesSH.value=se.texture,pe.probesMin.value.copy(se.boundingBox.min),pe.probesMax.value.copy(se.boundingBox.max),pe.probesResolution.value.copy(se.resolution)}za.upload(L,qh(gt),pe,q)}if(B.isShaderMaterial&&B.uniformsNeedUpdate===!0&&(za.upload(L,qh(gt),pe,q),B.uniformsNeedUpdate=!1),B.isSpriteMaterial&&ie.setValue(L,"center",k.center),ie.setValue(L,"modelViewMatrix",k.modelViewMatrix),ie.setValue(L,"normalMatrix",k.normalMatrix),ie.setValue(L,"modelMatrix",k.matrixWorld),B.uniformsGroups!==void 0){const se=B.uniformsGroups;for(let sn=0,$n=se.length;sn<$n;sn++){const $h=se[sn];j.update($h,ni),j.bind($h,ni)}}return ni}function Jd(S,F){S.ambientLightColor.needsUpdate=F,S.lightProbe.needsUpdate=F,S.directionalLights.needsUpdate=F,S.directionalLightShadows.needsUpdate=F,S.pointLights.needsUpdate=F,S.pointLightShadows.needsUpdate=F,S.spotLights.needsUpdate=F,S.spotLightShadows.needsUpdate=F,S.rectAreaLights.needsUpdate=F,S.hemisphereLights.needsUpdate=F}function Qd(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return Y},this.getActiveMipmapLevel=function(){return V},this.getRenderTarget=function(){return Q},this.setRenderTargetTextures=function(S,F,H){const B=G.get(S);B.__autoAllocateDepthBuffer=S.resolveDepthBuffer===!1,B.__autoAllocateDepthBuffer===!1&&(B.__useRenderToTexture=!1),G.get(S.texture).__webglTexture=F,G.get(S.depthTexture).__webglTexture=B.__autoAllocateDepthBuffer?void 0:H,B.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(S,F){const H=G.get(S);H.__webglFramebuffer=F,H.__useDefaultFramebuffer=F===void 0},this.setRenderTarget=function(S,F=0,H=0){Q=S,Y=F,V=H;let B=null,k=!1,pt=!1;if(S){const ft=G.get(S);if(ft.__useDefaultFramebuffer!==void 0){y.bindFramebuffer(L.FRAMEBUFFER,ft.__webglFramebuffer),ct.copy(S.viewport),_t.copy(S.scissor),Xt=S.scissorTest,y.viewport(ct),y.scissor(_t),y.setScissorTest(Xt),tt=-1;return}else if(ft.__webglFramebuffer===void 0)q.setupRenderTarget(S);else if(ft.__hasExternalTextures)q.rebindTextures(S,G.get(S.texture).__webglTexture,G.get(S.depthTexture).__webglTexture);else if(S.depthBuffer){const Nt=S.depthTexture;if(ft.__boundDepthTexture!==Nt){if(Nt!==null&&G.has(Nt)&&(S.width!==Nt.image.width||S.height!==Nt.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");q.setupDepthRenderbuffer(S)}}const Mt=S.texture;(Mt.isData3DTexture||Mt.isDataArrayTexture||Mt.isCompressedArrayTexture)&&(pt=!0);const bt=G.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(bt[F])?B=bt[F][H]:B=bt[F],k=!0):S.samples>0&&q.useMultisampledRTT(S)===!1?B=G.get(S).__webglMultisampledFramebuffer:Array.isArray(bt)?B=bt[H]:B=bt,ct.copy(S.viewport),_t.copy(S.scissor),Xt=S.scissorTest}else ct.copy(Tt).multiplyScalar(et).floor(),_t.copy(de).multiplyScalar(et).floor(),Xt=Bt;if(H!==0&&(B=z),y.bindFramebuffer(L.FRAMEBUFFER,B)&&y.drawBuffers(S,B),y.viewport(ct),y.scissor(_t),y.setScissorTest(Xt),k){const ft=G.get(S.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+F,ft.__webglTexture,H)}else if(pt){const ft=F;for(let Mt=0;Mt<S.textures.length;Mt++){const bt=G.get(S.textures[Mt]);L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0+Mt,bt.__webglTexture,H,ft)}}else if(S!==null&&H!==0){const ft=G.get(S.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,ft.__webglTexture,H)}tt=-1},this.readRenderTargetPixels=function(S,F,H,B,k,pt,xt,ft=0){if(!(S&&S.isWebGLRenderTarget)){Gt("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Mt=G.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&xt!==void 0&&(Mt=Mt[xt]),Mt){y.bindFramebuffer(L.FRAMEBUFFER,Mt);try{const bt=S.textures[ft],Nt=bt.format,Ot=bt.type;if(S.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+ft),!R.textureFormatReadable(Nt)){Gt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!R.textureTypeReadable(Ot)){Gt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}F>=0&&F<=S.width-B&&H>=0&&H<=S.height-k&&L.readPixels(F,H,B,k,ht.convert(Nt),ht.convert(Ot),pt)}finally{const bt=Q!==null?G.get(Q).__webglFramebuffer:null;y.bindFramebuffer(L.FRAMEBUFFER,bt)}}},this.readRenderTargetPixelsAsync=async function(S,F,H,B,k,pt,xt,ft=0){if(!(S&&S.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Mt=G.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&xt!==void 0&&(Mt=Mt[xt]),Mt)if(F>=0&&F<=S.width-B&&H>=0&&H<=S.height-k){y.bindFramebuffer(L.FRAMEBUFFER,Mt);const bt=S.textures[ft],Nt=bt.format,Ot=bt.type;if(S.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+ft),!R.textureFormatReadable(Nt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!R.textureTypeReadable(Ot))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const Et=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,Et),L.bufferData(L.PIXEL_PACK_BUFFER,pt.byteLength,L.STREAM_READ),L.readPixels(F,H,B,k,ht.convert(Nt),ht.convert(Ot),0);const Jt=Q!==null?G.get(Q).__webglFramebuffer:null;y.bindFramebuffer(L.FRAMEBUFFER,Jt);const fe=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await Lf(L,fe,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,Et),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,pt),L.deleteBuffer(Et),L.deleteSync(fe),pt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(S,F=null,H=0){const B=Math.pow(2,-H),k=Math.floor(S.image.width*B),pt=Math.floor(S.image.height*B),xt=F!==null?F.x:0,ft=F!==null?F.y:0;q.setTexture2D(S,0),L.copyTexSubImage2D(L.TEXTURE_2D,H,0,0,xt,ft,k,pt),y.unbindTexture()},this.copyTextureToTexture=function(S,F,H=null,B=null,k=0,pt=0){let xt,ft,Mt,bt,Nt,Ot,Et,Jt,fe;const ue=S.isCompressedTexture?S.mipmaps[pt]:S.image;if(H!==null)xt=H.max.x-H.min.x,ft=H.max.y-H.min.y,Mt=H.isBox3?H.max.z-H.min.z:1,bt=H.min.x,Nt=H.min.y,Ot=H.isBox3?H.min.z:0;else{const pe=Math.pow(2,-k);xt=Math.floor(ue.width*pe),ft=Math.floor(ue.height*pe),S.isDataArrayTexture?Mt=ue.depth:S.isData3DTexture?Mt=Math.floor(ue.depth*pe):Mt=1,bt=0,Nt=0,Ot=0}B!==null?(Et=B.x,Jt=B.y,fe=B.z):(Et=0,Jt=0,fe=0);const ee=ht.convert(F.format),Ne=ht.convert(F.type);let gt;F.isData3DTexture?(q.setTexture3D(F,0),gt=L.TEXTURE_3D):F.isDataArrayTexture||F.isCompressedArrayTexture?(q.setTexture2DArray(F,0),gt=L.TEXTURE_2D_ARRAY):(q.setTexture2D(F,0),gt=L.TEXTURE_2D),y.activeTexture(L.TEXTURE0),y.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,F.flipY),y.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,F.premultiplyAlpha),y.pixelStorei(L.UNPACK_ALIGNMENT,F.unpackAlignment);const $e=y.getParameter(L.UNPACK_ROW_LENGTH),Wt=y.getParameter(L.UNPACK_IMAGE_HEIGHT),ni=y.getParameter(L.UNPACK_SKIP_PIXELS),wi=y.getParameter(L.UNPACK_SKIP_ROWS),en=y.getParameter(L.UNPACK_SKIP_IMAGES);y.pixelStorei(L.UNPACK_ROW_LENGTH,ue.width),y.pixelStorei(L.UNPACK_IMAGE_HEIGHT,ue.height),y.pixelStorei(L.UNPACK_SKIP_PIXELS,bt),y.pixelStorei(L.UNPACK_SKIP_ROWS,Nt),y.pixelStorei(L.UNPACK_SKIP_IMAGES,Ot);const Yn=S.isDataArrayTexture||S.isData3DTexture,ie=F.isDataArrayTexture||F.isData3DTexture;if(S.isDepthTexture){const pe=G.get(S),nn=G.get(F),se=G.get(pe.__renderTarget),sn=G.get(nn.__renderTarget);y.bindFramebuffer(L.READ_FRAMEBUFFER,se.__webglFramebuffer),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,sn.__webglFramebuffer);for(let $n=0;$n<Mt;$n++)Yn&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,G.get(S).__webglTexture,k,Ot+$n),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,G.get(F).__webglTexture,pt,fe+$n)),L.blitFramebuffer(bt,Nt,xt,ft,Et,Jt,xt,ft,L.DEPTH_BUFFER_BIT,L.NEAREST);y.bindFramebuffer(L.READ_FRAMEBUFFER,null),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(k!==0||S.isRenderTargetTexture||G.has(S)){const pe=G.get(S),nn=G.get(F);y.bindFramebuffer(L.READ_FRAMEBUFFER,X),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,N);for(let se=0;se<Mt;se++)Yn?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,pe.__webglTexture,k,Ot+se):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,pe.__webglTexture,k),ie?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,nn.__webglTexture,pt,fe+se):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,nn.__webglTexture,pt),k!==0?L.blitFramebuffer(bt,Nt,xt,ft,Et,Jt,xt,ft,L.COLOR_BUFFER_BIT,L.NEAREST):ie?L.copyTexSubImage3D(gt,pt,Et,Jt,fe+se,bt,Nt,xt,ft):L.copyTexSubImage2D(gt,pt,Et,Jt,bt,Nt,xt,ft);y.bindFramebuffer(L.READ_FRAMEBUFFER,null),y.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else ie?S.isDataTexture||S.isData3DTexture?L.texSubImage3D(gt,pt,Et,Jt,fe,xt,ft,Mt,ee,Ne,ue.data):F.isCompressedArrayTexture?L.compressedTexSubImage3D(gt,pt,Et,Jt,fe,xt,ft,Mt,ee,ue.data):L.texSubImage3D(gt,pt,Et,Jt,fe,xt,ft,Mt,ee,Ne,ue):S.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,pt,Et,Jt,xt,ft,ee,Ne,ue.data):S.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,pt,Et,Jt,ue.width,ue.height,ee,ue.data):L.texSubImage2D(L.TEXTURE_2D,pt,Et,Jt,xt,ft,ee,Ne,ue);y.pixelStorei(L.UNPACK_ROW_LENGTH,$e),y.pixelStorei(L.UNPACK_IMAGE_HEIGHT,Wt),y.pixelStorei(L.UNPACK_SKIP_PIXELS,ni),y.pixelStorei(L.UNPACK_SKIP_ROWS,wi),y.pixelStorei(L.UNPACK_SKIP_IMAGES,en),pt===0&&F.generateMipmaps&&L.generateMipmap(gt),y.unbindTexture()},this.initRenderTarget=function(S){G.get(S).__webglFramebuffer===void 0&&q.setupRenderTarget(S)},this.initTexture=function(S){S.isCubeTexture?q.setTextureCube(S,0):S.isData3DTexture?q.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?q.setTexture2DArray(S,0):q.setTexture2D(S,0),y.unbindTexture()},this.resetState=function(){Y=0,V=0,Q=null,y.reset(),mt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Di}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=kt._getDrawingBufferColorSpace(t),e.unpackColorSpace=kt._getUnpackColorSpace()}}const tu={type:"change"},Ih={type:"start"},Ld={type:"end"},ea=new Ch,eu=new xn,L_=Math.cos(70*Ql.DEG2RAD),Se=new U,Xe=2*Math.PI,jt={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},Oo=1e-6;class N_ extends Ed{constructor(t,e=null){super(t,e),this.state=jt.NONE,this.target=new U,this.cursor=new U,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:Fs.ROTATE,MIDDLE:Fs.DOLLY,RIGHT:Fs.PAN},this.touches={ONE:Is.ROTATE,TWO:Is.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle="auto",this._domElementKeyEvents=null,this._lastPosition=new U,this._lastQuaternion=new En,this._lastTargetPosition=new U,this._quat=new En().setFromUnitVectors(t.up,new U(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Pc,this._sphericalDelta=new Pc,this._scale=1,this._panOffset=new U,this._rotateStart=new Pt,this._rotateEnd=new Pt,this._rotateDelta=new Pt,this._panStart=new Pt,this._panEnd=new Pt,this._panDelta=new Pt,this._dollyStart=new Pt,this._dollyEnd=new Pt,this._dollyDelta=new Pt,this._dollyDirection=new U,this._mouse=new Pt,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=U_.bind(this),this._onPointerDown=F_.bind(this),this._onPointerUp=O_.bind(this),this._onContextMenu=W_.bind(this),this._onMouseWheel=k_.bind(this),this._onKeyDown=V_.bind(this),this._onTouchStart=G_.bind(this),this._onTouchMove=H_.bind(this),this._onMouseDown=z_.bind(this),this._onMouseMove=B_.bind(this),this._interceptControlDown=X_.bind(this),this._interceptControlUp=q_.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(t){this._cursorStyle=t,t==="grab"?this.domElement.style.cursor="grab":this.domElement.style.cursor="auto"}get cursorStyle(){return this._cursorStyle}connect(t){super.connect(t),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction=""}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(t){t.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=t}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(tu),this.update(),this.state=jt.NONE}pan(t,e){this._pan(t,e),this.update()}dollyIn(t){this._dollyIn(t),this.update()}dollyOut(t){this._dollyOut(t),this.update()}rotateLeft(t){this._rotateLeft(t),this.update()}rotateUp(t){this._rotateUp(t),this.update()}update(t=null){const e=this.object.position;Se.copy(e).sub(this.target),Se.applyQuaternion(this._quat),this._spherical.setFromVector3(Se),this.autoRotate&&this.state===jt.NONE&&this._rotateLeft(this._getAutoRotationAngle(t)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let i=this.minAzimuthAngle,n=this.maxAzimuthAngle;isFinite(i)&&isFinite(n)&&(i<-Math.PI?i+=Xe:i>Math.PI&&(i-=Xe),n<-Math.PI?n+=Xe:n>Math.PI&&(n-=Xe),i<=n?this._spherical.theta=Math.max(i,Math.min(n,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(i+n)/2?Math.max(i,this._spherical.theta):Math.min(n,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let r=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{const a=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),r=a!=this._spherical.radius}if(Se.setFromSpherical(this._spherical),Se.applyQuaternion(this._quatInverse),e.copy(this.target).add(Se),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let a=null;if(this.object.isPerspectiveCamera){const o=Se.length();a=this._clampDistance(o*this._scale);const l=o-a;this.object.position.addScaledVector(this._dollyDirection,l),this.object.updateMatrixWorld(),r=!!l}else if(this.object.isOrthographicCamera){const o=new U(this._mouse.x,this._mouse.y,0);o.unproject(this.object);const l=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),r=l!==this.object.zoom;const h=new U(this._mouse.x,this._mouse.y,0);h.unproject(this.object),this.object.position.sub(h).add(o),this.object.updateMatrixWorld(),a=Se.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;a!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(a).add(this.object.position):(ea.origin.copy(this.object.position),ea.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(ea.direction))<L_?this.object.lookAt(this.target):(eu.setFromNormalAndCoplanarPoint(this.object.up,this.target),ea.intersectPlane(eu,this.target))))}else if(this.object.isOrthographicCamera){const a=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),a!==this.object.zoom&&(this.object.updateProjectionMatrix(),r=!0)}return this._scale=1,this._performCursorZoom=!1,r||this._lastPosition.distanceToSquared(this.object.position)>Oo||8*(1-this._lastQuaternion.dot(this.object.quaternion))>Oo||this._lastTargetPosition.distanceToSquared(this.target)>Oo?(this.dispatchEvent(tu),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(t){return t!==null?Xe/60*this.autoRotateSpeed*t:Xe/60/60*this.autoRotateSpeed}_getZoomScale(t){const e=Math.abs(t*.01);return Math.pow(.95,this.zoomSpeed*e)}_rotateLeft(t){this._sphericalDelta.theta-=t}_rotateUp(t){this._sphericalDelta.phi-=t}_panLeft(t,e){Se.setFromMatrixColumn(e,0),Se.multiplyScalar(-t),this._panOffset.add(Se)}_panUp(t,e){this.screenSpacePanning===!0?Se.setFromMatrixColumn(e,1):(Se.setFromMatrixColumn(e,0),Se.crossVectors(this.object.up,Se)),Se.multiplyScalar(t),this._panOffset.add(Se)}_pan(t,e){const i=this.domElement;if(this.object.isPerspectiveCamera){const n=this.object.position;Se.copy(n).sub(this.target);let r=Se.length();r*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*t*r/i.clientHeight,this.object.matrix),this._panUp(2*e*r/i.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(t*(this.object.right-this.object.left)/this.object.zoom/i.clientWidth,this.object.matrix),this._panUp(e*(this.object.top-this.object.bottom)/this.object.zoom/i.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(t){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=t:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(t,e){if(!this.zoomToCursor)return;this._performCursorZoom=!0;const i=this.domElement.getBoundingClientRect(),n=t-i.left,r=e-i.top,a=i.width,o=i.height;this._mouse.x=n/a*2-1,this._mouse.y=-(r/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(t){return Math.max(this.minDistance,Math.min(this.maxDistance,t))}_handleMouseDownRotate(t){this._rotateStart.set(t.clientX,t.clientY)}_handleMouseDownDolly(t){this._updateZoomParameters(t.clientX,t.clientX),this._dollyStart.set(t.clientX,t.clientY)}_handleMouseDownPan(t){this._panStart.set(t.clientX,t.clientY)}_handleMouseMoveRotate(t){this._rotateEnd.set(t.clientX,t.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Xe*this._rotateDelta.x/e.clientHeight),this._rotateUp(Xe*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(t){this._dollyEnd.set(t.clientX,t.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(t){this._panEnd.set(t.clientX,t.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(t){this._updateZoomParameters(t.clientX,t.clientY),t.deltaY<0?this._dollyIn(this._getZoomScale(t.deltaY)):t.deltaY>0&&this._dollyOut(this._getZoomScale(t.deltaY)),this.update()}_handleKeyDown(t){let e=!1;switch(t.code){case this.keys.UP:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(Xe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),e=!0;break;case this.keys.BOTTOM:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateUp(-Xe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),e=!0;break;case this.keys.LEFT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(Xe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),e=!0;break;case this.keys.RIGHT:t.ctrlKey||t.metaKey||t.shiftKey?this.enableRotate&&this._rotateLeft(-Xe*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),e=!0;break}e&&(t.preventDefault(),this.update())}_handleTouchStartRotate(t){if(this._pointers.length===1)this._rotateStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._rotateStart.set(i,n)}}_handleTouchStartPan(t){if(this._pointers.length===1)this._panStart.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._panStart.set(i,n)}}_handleTouchStartDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,n=t.pageY-e.y,r=Math.sqrt(i*i+n*n);this._dollyStart.set(0,r)}_handleTouchStartDollyPan(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enablePan&&this._handleTouchStartPan(t)}_handleTouchStartDollyRotate(t){this.enableZoom&&this._handleTouchStartDolly(t),this.enableRotate&&this._handleTouchStartRotate(t)}_handleTouchMoveRotate(t){if(this._pointers.length==1)this._rotateEnd.set(t.pageX,t.pageY);else{const i=this._getSecondPointerPosition(t),n=.5*(t.pageX+i.x),r=.5*(t.pageY+i.y);this._rotateEnd.set(n,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);const e=this.domElement;this._rotateLeft(Xe*this._rotateDelta.x/e.clientHeight),this._rotateUp(Xe*this._rotateDelta.y/e.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(t){if(this._pointers.length===1)this._panEnd.set(t.pageX,t.pageY);else{const e=this._getSecondPointerPosition(t),i=.5*(t.pageX+e.x),n=.5*(t.pageY+e.y);this._panEnd.set(i,n)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(t){const e=this._getSecondPointerPosition(t),i=t.pageX-e.x,n=t.pageY-e.y,r=Math.sqrt(i*i+n*n);this._dollyEnd.set(0,r),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);const a=(t.pageX+e.x)*.5,o=(t.pageY+e.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enablePan&&this._handleTouchMovePan(t)}_handleTouchMoveDollyRotate(t){this.enableZoom&&this._handleTouchMoveDolly(t),this.enableRotate&&this._handleTouchMoveRotate(t)}_addPointer(t){this._pointers.push(t.pointerId)}_removePointer(t){delete this._pointerPositions[t.pointerId];for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId){this._pointers.splice(e,1);return}}_isTrackingPointer(t){for(let e=0;e<this._pointers.length;e++)if(this._pointers[e]==t.pointerId)return!0;return!1}_trackPointer(t){let e=this._pointerPositions[t.pointerId];e===void 0&&(e=new Pt,this._pointerPositions[t.pointerId]=e),e.set(t.pageX,t.pageY)}_getSecondPointerPosition(t){const e=t.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[e]}_customWheelEvent(t){const e=t.deltaMode,i={clientX:t.clientX,clientY:t.clientY,deltaY:t.deltaY};switch(e){case 1:i.deltaY*=16;break;case 2:i.deltaY*=100;break}return t.ctrlKey&&!this._controlActive&&(i.deltaY*=10),i}}function F_(s){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(s.pointerId),this.domElement.ownerDocument.addEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(s)&&(this._addPointer(s),s.pointerType==="touch"?this._onTouchStart(s):this._onMouseDown(s),this._cursorStyle==="grab"&&(this.domElement.style.cursor="grabbing")))}function U_(s){this.enabled!==!1&&(s.pointerType==="touch"?this._onTouchMove(s):this._onMouseMove(s))}function O_(s){switch(this._removePointer(s),this._pointers.length){case 0:this.domElement.releasePointerCapture(s.pointerId),this.domElement.ownerDocument.removeEventListener("pointermove",this._onPointerMove),this.domElement.ownerDocument.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(Ld),this.state=jt.NONE,this._cursorStyle==="grab"&&(this.domElement.style.cursor="grab");break;case 1:const t=this._pointers[0],e=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:e.x,pageY:e.y});break}}function z_(s){let t;switch(s.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case Fs.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(s),this.state=jt.DOLLY;break;case Fs.ROTATE:if(s.ctrlKey||s.metaKey||s.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(s),this.state=jt.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(s),this.state=jt.ROTATE}break;case Fs.PAN:if(s.ctrlKey||s.metaKey||s.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(s),this.state=jt.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(s),this.state=jt.PAN}break;default:this.state=jt.NONE}this.state!==jt.NONE&&this.dispatchEvent(Ih)}function B_(s){switch(this.state){case jt.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(s);break;case jt.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(s);break;case jt.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(s);break}}function k_(s){this.enabled===!1||this.enableZoom===!1||this.state!==jt.NONE||(s.preventDefault(),this.dispatchEvent(Ih),this._handleMouseWheel(this._customWheelEvent(s)),this.dispatchEvent(Ld))}function V_(s){this.enabled!==!1&&this._handleKeyDown(s)}function G_(s){switch(this._trackPointer(s),this._pointers.length){case 1:switch(this.touches.ONE){case Is.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(s),this.state=jt.TOUCH_ROTATE;break;case Is.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(s),this.state=jt.TOUCH_PAN;break;default:this.state=jt.NONE}break;case 2:switch(this.touches.TWO){case Is.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(s),this.state=jt.TOUCH_DOLLY_PAN;break;case Is.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(s),this.state=jt.TOUCH_DOLLY_ROTATE;break;default:this.state=jt.NONE}break;default:this.state=jt.NONE}this.state!==jt.NONE&&this.dispatchEvent(Ih)}function H_(s){switch(this._trackPointer(s),this.state){case jt.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(s),this.update();break;case jt.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(s),this.update();break;case jt.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(s),this.update();break;case jt.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(s),this.update();break;default:this.state=jt.NONE}}function W_(s){this.enabled!==!1&&s.preventDefault()}function X_(s){s.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function q_(s){s.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}const cs=new wn(0,0,0,"YXZ"),us=new U,Y_={type:"change"},$_={type:"lock"},Z_={type:"unlock"},iu=.002,nu=Math.PI/2;class K_ extends Ed{constructor(t,e=null){super(t,e),this.isLocked=!1,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.pointerSpeed=1,this._onMouseMove=J_.bind(this),this._onPointerlockChange=Q_.bind(this),this._onPointerlockError=j_.bind(this),this.domElement!==null&&this.connect(this.domElement)}connect(t){super.connect(t),this.domElement.ownerDocument.addEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.addEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.addEventListener("pointerlockerror",this._onPointerlockError)}disconnect(){this.domElement.ownerDocument.removeEventListener("mousemove",this._onMouseMove),this.domElement.ownerDocument.removeEventListener("pointerlockchange",this._onPointerlockChange),this.domElement.ownerDocument.removeEventListener("pointerlockerror",this._onPointerlockError)}dispose(){this.disconnect()}getDirection(t){return t.set(0,0,-1).applyQuaternion(this.object.quaternion)}moveForward(t){if(this.enabled===!1)return;const e=this.object;us.setFromMatrixColumn(e.matrix,0),us.crossVectors(e.up,us),e.position.addScaledVector(us,t)}moveRight(t){if(this.enabled===!1)return;const e=this.object;us.setFromMatrixColumn(e.matrix,0),e.position.addScaledVector(us,t)}lock(t=!1){this.domElement.requestPointerLock({unadjustedMovement:t})}unlock(){this.domElement.ownerDocument.exitPointerLock()}}function J_(s){if(this.enabled===!1||this.isLocked===!1)return;const t=this.object;cs.setFromQuaternion(t.quaternion),cs.y-=s.movementX*iu*this.pointerSpeed,cs.x-=s.movementY*iu*this.pointerSpeed,cs.x=Math.max(nu-this.maxPolarAngle,Math.min(nu-this.minPolarAngle,cs.x)),t.quaternion.setFromEuler(cs),this.dispatchEvent(Y_)}function Q_(){this.domElement.ownerDocument.pointerLockElement===this.domElement?(this.dispatchEvent($_),this.isLocked=!0):(this.dispatchEvent(Z_),this.isLocked=!1)}function j_(){console.error("THREE.PointerLockControls: Unable to use Pointer Lock API")}class ty extends Oa{constructor(){super(),this.name="RoomEnvironment",this.position.y=-3.5;const t=new Xn;t.deleteAttribute("uv");const e=new bc({side:Le}),i=new bc,n=new Ip(16777215,900,28,2);n.position.set(.418,16.199,.3),this.add(n);const r=new Me(t,e);r.position.set(-.757,13.219,.717),r.scale.set(31.713,28.305,28.591),this.add(r);const a=new gp(t,i,6),o=new Si;o.position.set(-10.906,2.009,1.846),o.rotation.set(0,-.195,0),o.scale.set(2.328,7.905,4.651),o.updateMatrix(),a.setMatrixAt(0,o.matrix),o.position.set(-5.607,-.754,-.758),o.rotation.set(0,.994,0),o.scale.set(1.97,1.534,3.955),o.updateMatrix(),a.setMatrixAt(1,o.matrix),o.position.set(6.167,.857,7.803),o.rotation.set(0,.561,0),o.scale.set(3.927,6.285,3.687),o.updateMatrix(),a.setMatrixAt(2,o.matrix),o.position.set(-2.017,.018,6.124),o.rotation.set(0,.333,0),o.scale.set(2.002,4.566,2.064),o.updateMatrix(),a.setMatrixAt(3,o.matrix),o.position.set(2.291,-.756,-2.621),o.rotation.set(0,-.286,0),o.scale.set(1.546,1.552,1.496),o.updateMatrix(),a.setMatrixAt(4,o.matrix),o.position.set(-2.193,-.369,-5.547),o.rotation.set(0,.516,0),o.scale.set(3.875,3.487,2.986),o.updateMatrix(),a.setMatrixAt(5,o.matrix),this.add(a);const l=new Me(t,ds(50));l.position.set(-16.116,14.37,8.208),l.scale.set(.1,2.428,2.739),this.add(l);const h=new Me(t,ds(50));h.position.set(-16.109,18.021,-8.207),h.scale.set(.1,2.425,2.751),this.add(h);const u=new Me(t,ds(17));u.position.set(14.904,12.198,-1.832),u.scale.set(.15,4.265,6.331),this.add(u);const d=new Me(t,ds(43));d.position.set(-.462,8.89,14.52),d.scale.set(4.38,5.441,.088),this.add(d);const c=new Me(t,ds(20));c.position.set(3.235,11.486,-12.541),c.scale.set(2.5,2,.1),this.add(c);const f=new Me(t,ds(100));f.position.set(0,20,0),f.scale.set(1,.1,1),this.add(f)}dispose(){const t=new Set;this.traverse(e=>{e.isMesh&&(t.add(e.geometry),t.add(e.material))});for(const e of t)e.dispose()}}function ds(s){return new Tp({color:0,emissive:16777215,emissiveIntensity:s})}class br extends Me{constructor(){const t=br.SkyShader,e=new hi({name:t.name,uniforms:vd.clone(t.uniforms),vertexShader:t.vertexShader,fragmentShader:t.fragmentShader,side:Le,depthWrite:!1});super(new Xn(1,1,1),e),this.isSky=!0}}br.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new U},up:{value:new U(0,1,0)},cloudScale:{value:2e-4},cloudSpeed:{value:1e-4},cloudCoverage:{value:.4},cloudDensity:{value:.4},cloudElevation:{value:.5},showSunDisc:{value:1},time:{value:0}},vertexShader:`
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

		}`};const ey=`
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
`;function su(s={}){const t=Number(s.radius??4e3),e=ru(s.sunDirection,[.35,.22,-1]).normalize(),i={uZenith:{value:new Dt(s.zenith??2781124)},uHorizon:{value:new Dt(s.horizon??12376046)},uGround:{value:new Dt(s.ground??7038296)},uSunColor:{value:new Dt(s.sunColor??16773840)},uCloudColor:{value:new Dt(s.cloudColor??16777215)},uCloudShadow:{value:new Dt(s.cloudShadow??9083824)},uSunDirection:{value:e.clone()},uSunSize:{value:Number(s.sunSize??.004)},uSunGlow:{value:Number(s.sunGlow??220)},uCloudCoverage:{value:Number(s.cloudCoverage??.48)},uCloudOpacity:{value:Number(s.cloudOpacity??.9)},uCloudScale:{value:Number(s.cloudScale??1.6)},uCloudSpeed:{value:Number(s.cloudSpeed??.006)},uWindOffset:{value:new Pt},uWindDriven:{value:0},uHaze:{value:Number(s.haze??.35)},uTime:{value:0}},n=new hi({uniforms:i,side:Le,depthWrite:!1,depthTest:!1,vertexShader:`
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
      ${ey}
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
    `}),r=new Me(new vp(t,48,32),n);return r.name="A3GameSkyGradient",r.frustumCulled=!1,r.renderOrder=-1e3,r.onBeforeRender=(a,o,l)=>{l.getWorldPosition(r.position),r.parent&&r.parent.worldToLocal(r.position),r.updateMatrixWorld(!0)},r.userData.update=(a,o=s.windField)=>{if(i.uTime.value+=Number(a)||0,o){const l=i.uCloudScale.value/Math.max(1,Number(s.cloudHeight??120));i.uWindOffset.value.set(-o.displacement.x*l,-o.displacement.z*l),i.uWindDriven.value=1}},r.userData.setSunDirection=a=>{i.uSunDirection.value.copy(ru(a,[.35,.22,-1])).normalize()},r.userData.uniforms=i,r}function ru(s,t=[0,0,0]){return s?.isVector3?s.clone():Array.isArray(s)&&s.length>=3?new U(Number(s[0]),Number(s[1]),Number(s[2])):s&&typeof s=="object"&&"x"in s?new U(Number(s.x??0),Number(s.y??0),Number(s.z??0)):new U(t[0],t[1],t[2])}const iy=(s=[0,0,0])=>{const t=Array.isArray(s)?s:[s.x,s.y,s.z];if(t.length!==3||!t.every(e=>Number.isFinite(Number(e))))throw new TypeError("Wind velocity must contain three finite numbers in metres/second");return new U(...t.map(Number))},fs=(s,t,e=0)=>{const i=Number(s??t);if(!Number.isFinite(i)||i<e)throw new RangeError("Invalid wind parameter");return i};class ny{constructor(t={}){this.velocity=new U,this.targetVelocity=new U,this.displacement=new U,this.elapsedSeconds=0,this.set(t,!0)}set(t={},e=!1){const i=t.velocity===void 0?this.targetVelocity.clone():iy(t.velocity),n=fs(t.gustStrength,this.gustStrength??0),r=fs(t.gustPeriod,this.gustPeriod??6,.1),a=fs(t.spatialScale,this.spatialScale??30,.1),o=fs(t.response,this.response??1.5,.01),l=fs(t.heightShear,this.heightShear??.05),h=fs(t.seed,this.seed??1,-Number.MAX_SAFE_INTEGER);return Object.assign(this,{gustStrength:n,gustPeriod:r,spatialScale:a,response:o,heightShear:l,seed:h}),this.targetVelocity.copy(i),e&&this.velocity.copy(i),this}sample(t,e=this.elapsedSeconds,i=new U){const n=Number(e);if(!Number.isFinite(n))throw new RangeError("Wind time must be finite");const r=t?.x??0,a=t?.y??0,o=t?.z??0,l=this.seed%1e4*.61803398875,h=2*Math.PI/this.gustPeriod,u=Math.sin(n*h+r/this.spatialScale+l),d=Math.sin(n*h*.63-o/this.spatialScale+l*2.1),c=1+this.heightShear*Math.log1p(Math.max(0,a)/10);i.copy(this.velocity).multiplyScalar(c);const f=Math.hypot(this.velocity.x,this.velocity.z),g=f>1e-9?this.velocity.x/f:1,_=f>1e-9?this.velocity.z/f:0;return i.x+=this.gustStrength*(g*u-_*d*.25),i.z+=this.gustStrength*(_*u+g*d*.25),i}update(t){if(!Number.isFinite(t)||t<0)throw new RangeError("Wind dt must be finite and non-negative");if(t===0)return this;const e=this.sample(null,this.elapsedSeconds);this.velocity.lerp(this.targetVelocity,1-Math.exp(-t/this.response)),this.elapsedSeconds+=t;const i=this.sample(null,this.elapsedSeconds);return this.displacement.addScaledVector(e.add(i),t*.5),this}getState(){return{velocity:this.velocity.toArray(),targetVelocity:this.targetVelocity.toArray(),gustStrength:this.gustStrength,gustPeriod:this.gustPeriod,spatialScale:this.spatialScale,elapsedSeconds:this.elapsedSeconds,displacement:this.displacement.toArray(),seed:this.seed}}}const Ln=Object.freeze({ROOM:"room",SKY:"sky",GRADIENT:"gradient",NONE:"none"}),zo=Object.freeze({NoToneMapping:yi,LinearToneMapping:ch,ReinhardToneMapping:uh,CineonToneMapping:dh,ACESFilmicToneMapping:fh,AgXToneMapping:ph,NeutralToneMapping:Qa}),au=s=>s?typeof s=="string"?document.querySelector(s):s:null;class sy{constructor(t={}){this.options={antialias:!0,shadows:!0,pixelRatioCap:2,clearColor:1052692,toneMapping:"NeutralToneMapping",toneMappingExposure:1,cameraType:"perspective",frustumHeight:12,fov:50,near:.1,far:2e3,fixedTimeStep:1/60,maxSubSteps:6,maxFrameDelta:.1,environmentUpdateInterval:0,...t};for(const e of["fixedTimeStep","maxFrameDelta","environmentUpdateInterval"]){const i=Number(this.options[e]);if(!Number.isFinite(i)||i<0||e==="maxFrameDelta"&&i===0)throw new RangeError(`${e} must be finite and ${e==="maxFrameDelta"?"positive":"non-negative"}`);this.options[e]=i}if(!Number.isInteger(this.options.maxSubSteps)||this.options.maxSubSteps<1)throw new RangeError("maxSubSteps must be a positive integer");this.container=au(t.container),this.hudContainer=au(t.hudContainer),this.renderer=null,this.scene=null,this.camera=null,this.controls=null,this.generatedEnvironment=null,this.skyDome=null,this.sunDirection=new U(.35,.22,-1).normalize(),this.wind=new ny(t.wind??{}),this.clock=new Up,this.raycaster=new Fp,this.pointer=new Pt,this.frameHandle=null,this.running=!1,this.frameCount=0,this.elapsedSeconds=0,this.accumulator=0,this.interpolationAlpha=0,this.droppedSeconds=0,this.lastSubSteps=0,this.renderListeners=new Set,this.interpolatedObjects=new Map,this.sunLights=new Map,this.sunConfigured=!1,this.environmentPresetOptions=null,this.environmentAge=0,this.generatedEnvironmentTarget=null,this.tickListeners=new Set,this.resizeListeners=new Set,this.namedRoots=new Map,this.resizeObserver=null,this.onWindowResize=null}async init(){if(!this.container)throw new Error("A3GameRuntimeHost requires an existing container element");const{clientWidth:t,clientHeight:e}=this.#l();return this.renderer=new I_({antialias:this.options.antialias,alpha:!1,powerPreference:"high-performance",preserveDrawingBuffer:!0}),this.renderer.outputColorSpace=je,this.renderer.setClearColor(new Dt(this.options.clearColor)),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,this.options.pixelRatioCap)),this.renderer.setSize(t,e),this.renderer.toneMapping=zo[this.options.toneMapping]??Qa,this.renderer.toneMappingExposure=this.options.toneMappingExposure,this.renderer.shadowMap.enabled=!!this.options.shadows,this.renderer.shadowMap.type=Yu,this.container.appendChild(this.renderer.domElement),this.scene=new Oa,this.scene.name="A3GameWorld",this.camera=this.#u(this.options.cameraType,t/Math.max(1,e)),this.camera.name="A3GameCamera",this.camera.position.set(0,2,8),this.camera.lookAt(0,1,0),this.#f(),this}usePerspectiveCamera(t={}){return Object.assign(this.options,{cameraType:"perspective",fov:Number(t.fov??this.options.fov),near:Number(t.near??this.options.near),far:Number(t.far??this.options.far)}),this.#d("perspective")}useOrthographicCamera(t={}){return Object.assign(this.options,{cameraType:"orthographic",frustumHeight:Math.max(.01,Number(t.frustumHeight??this.options.frustumHeight)),near:Number(t.near??-this.options.far),far:Number(t.far??this.options.far)}),this.#d("orthographic")}start(){if(this.running)return this;if(!this.renderer||!this.scene||!this.camera)throw new Error("A3GameRuntimeHost.init() must run before start()");this.running=!0,this.clock.start();const t=()=>{this.running&&(this.frameHandle=requestAnimationFrame(t),this.tick())};return this.frameHandle=requestAnimationFrame(t),this}stop(){return this.running=!1,this.frameHandle!==null&&(cancelAnimationFrame(this.frameHandle),this.frameHandle=null),this}tick(t){const e=t===void 0?this.clock.getDelta():Number(t);if(!Number.isFinite(e)||e<0)throw new RangeError("tick delta must be finite and non-negative");const i=Math.min(e,this.options.maxFrameDelta);this.droppedSeconds+=e-i,this.frameCount+=1,this.lastSubSteps=0;const n=this.options.fixedTimeStep;if(n>0){for(this.accumulator+=i;this.accumulator+n*1e-9>=n&&this.lastSubSteps<this.options.maxSubSteps;)this.#e(n),this.accumulator=Math.max(0,this.accumulator-n),this.lastSubSteps+=1;if(this.accumulator>=n){const r=Math.floor(this.accumulator/n)*n;this.droppedSeconds+=r,this.accumulator-=r}this.interpolationAlpha=this.accumulator/n}else this.#e(i),this.lastSubSteps=1,this.interpolationAlpha=1;return this.#i(i),this}#e(t){for(const[i,n]of this.interpolatedObjects)n.position.copy(i.position),n.quaternion.copy(i.quaternion),n.scale.copy(i.scale);this.elapsedSeconds+=t,this.#h(t),this.environmentAge+=t;const e=this.options.environmentUpdateInterval;e>0&&this.environmentAge>=e&&this.generatedEnvironment&&this.refreshEnvironment()}#i(t){const e=[];try{for(const[i,n]of this.interpolatedObjects){const r=n.current;r.position.copy(i.position),r.quaternion.copy(i.quaternion),r.scale.copy(i.scale),e.push([i,r]),i.position.lerpVectors(n.position,r.position,this.interpolationAlpha),i.quaternion.slerpQuaternions(n.quaternion,r.quaternion,this.interpolationAlpha),i.scale.lerpVectors(n.scale,r.scale,this.interpolationAlpha),i.updateMatrixWorld(!0)}for(const i of this.renderListeners)i(t,this.interpolationAlpha);this.controls?.update?.(t),this.renderer?.render(this.scene,this.camera)}finally{for(const[i,n]of e)i.position.copy(n.position),i.quaternion.copy(n.quaternion),i.scale.copy(n.scale),i.updateMatrixWorld(!0)}}onRender(t){if(typeof t!="function")throw new TypeError("onRender requires a function");return this.renderListeners.add(t),()=>this.renderListeners.delete(t)}interpolateObject(t){if(!t?.isObject3D)throw new TypeError("interpolateObject requires an Object3D");const e=()=>({position:t.position.clone(),quaternion:t.quaternion.clone(),scale:t.scale.clone()});return this.interpolatedObjects.set(t,{...e(),current:e()}),()=>this.interpolatedObjects.delete(t)}resetInterpolation(t){return this.interpolatedObjects.has(t)&&this.interpolateObject(t),this}onTick(t){if(typeof t!="function")throw new TypeError("onTick requires a function");return this.tickListeners.add(t),()=>this.tickListeners.delete(t)}onResize(t){if(typeof t!="function")throw new TypeError("onResize requires a function");return this.resizeListeners.add(t),()=>this.resizeListeners.delete(t)}add(t,e="entities"){if(!this.scene)throw new Error("init() must run before add()");let i=this.namedRoots.get(e);return i||(i=new Ls,i.name=`A3Game_${e}`,this.scene.add(i),this.namedRoots.set(e,i)),i.add(t),t.traverse(n=>{n.isDirectionalLight&&n.userData.a3gameSun&&this.registerSunLight(n)}),t}remove(t){return t?.traverse?.(e=>{this.sunLights.delete(e),this.interpolatedObjects.delete(e)}),t?.parent?.remove(t),this}registerSunLight(t,e){if(!t?.isDirectionalLight)throw new TypeError("Sun must be a DirectionalLight");t.updateWorldMatrix(!0,!1),t.target.updateWorldMatrix(!0,!1);const i=e??t.getWorldPosition(new U).distanceTo(t.target.getWorldPosition(new U));if(!Number.isFinite(i)||i<=0)throw new RangeError("Sun distance must be positive");return this.sunLights.set(t,i),!t.target.parent&&this.scene&&this.scene.add(t.target),this.sunConfigured&&this.#n(),()=>this.sunLights.delete(t)}#n(){this.skyDome?.userData?.setSunDirection?.(this.sunDirection),this.skyDome?.material?.uniforms?.sunPosition?.value.copy(this.sunDirection);for(const[t,e]of this.sunLights){const i=t.target.getWorldPosition(new U).addScaledVector(this.sunDirection,e);t.parent&&t.parent.worldToLocal(i),t.position.copy(i),t.updateMatrixWorld(!0)}}refreshEnvironment(){return this.generatedEnvironment&&this.environmentPresetOptions&&this.#t(this.environmentPresetOptions,!0),this.environmentAge=0,this}getRoot(t="entities"){return this.namedRoots.has(t)||this.add(new Ls,t),this.namedRoots.get(t)}attachOrbitControls(t={}){this.detachControls();const e=new N_(this.camera,this.renderer.domElement);e.enableDamping=t.enableDamping!==!1,e.dampingFactor=.08,e.screenSpacePanning=!1,t.maxPolarAngle!==void 0&&(e.maxPolarAngle=t.maxPolarAngle),t.minDistance!==void 0&&(e.minDistance=t.minDistance),t.maxDistance!==void 0&&(e.maxDistance=t.maxDistance);const i=t.target??{x:0,y:1,z:0};return e.target.set(i.x,i.y,i.z),e.update(),this.controls=e,e}attachPointerLockControls(){this.detachControls();const t=new K_(this.camera,this.container);return this.controls=t,t}async requestPointerLock(){const t=this.container;if(!t?.requestPointerLock)return!1;try{const e=t.requestPointerLock({unadjustedMovement:!0});return e&&typeof e.then=="function"&&await e,!0}catch{try{return t.requestPointerLock(),!0}catch{return!1}}}exitPointerLock(){return document.pointerLockElement&&document.exitPointerLock?.(),this}isPointerLocked(){return document.pointerLockElement===this.container}setFrustumHeight(t){const e=Math.max(.01,Number(t)||0);return e===this.options.frustumHeight?this:(this.options.frustumHeight=e,this.camera?.isOrthographicCamera&&this.#c(),this)}detachControls(){return this.controls&&typeof this.controls.dispose=="function"&&this.controls.dispose(),this.controls=null,this}setWind(t,e=!1){return this.wind.set(t,e),this}setEnvironment(t={}){if(!this.scene)throw new Error("init() must run before setEnvironment()");t.wind&&this.setWind(t.wind);let e=!1;if(t.sunPosition){const i=new U(Number(t.sunPosition.x??0),Number(t.sunPosition.y??1),Number(t.sunPosition.z??0));if(!i.toArray().every(Number.isFinite)||i.lengthSq()<1e-12)throw new RangeError("sunPosition must be a finite non-zero direction");i.normalize(),e=this.sunDirection.distanceToSquared(i)>1e-12,this.sunDirection.copy(i),this.sunConfigured=!0}return t.preset!==void 0?(this.environmentPresetOptions={...t,sunPosition:this.sunDirection.clone()},this.#t(this.environmentPresetOptions),this.sunConfigured=!0):e&&this.environmentPresetOptions&&(this.environmentPresetOptions.sunPosition=this.sunDirection.clone(),t.environmentTexture||this.refreshEnvironment()),this.sunConfigured&&this.#n(),t.background!==void 0&&(this.scene.background=t.background===null?null:new Dt(t.background)),t.environmentTexture&&(t.environmentTexture.mapping=mr,this.#o(),this.scene.environment=t.environmentTexture),t.backgroundTexture&&(t.backgroundTexture.mapping=mr,this.#r(),this.scene.background=t.backgroundTexture),t.environmentIntensity!==void 0&&(this.scene.environmentIntensity=Number(t.environmentIntensity)),t.backgroundIntensity!==void 0&&(this.scene.backgroundIntensity=Number(t.backgroundIntensity)),t.backgroundBlurriness!==void 0&&(this.scene.backgroundBlurriness=Number(t.backgroundBlurriness)),t.backgroundRotationDegrees!==void 0&&this.scene.backgroundRotation.set(0,Ql.degToRad(Number(t.backgroundRotationDegrees)),0),t.environmentRotationDegrees!==void 0&&this.scene.environmentRotation.set(0,Ql.degToRad(Number(t.environmentRotationDegrees)),0),t.toneMapping&&Object.hasOwn(zo,t.toneMapping)&&(this.options.toneMapping=t.toneMapping,this.renderer&&(this.renderer.toneMapping=zo[t.toneMapping])),t.toneMappingExposure!==void 0&&(this.options.toneMappingExposure=Number(t.toneMappingExposure),this.renderer&&(this.renderer.toneMappingExposure=this.options.toneMappingExposure)),this}getSunDirection(){return this.sunDirection.clone()}getSunPosition(t=100){return this.sunDirection.clone().multiplyScalar(Number(t)||1)}#t(t,e=!1){const i=String(t.preset??"none").toLowerCase(),n=this.skyDome?.userData?.uniforms?.uTime?.value??0;if(i===Ln.NONE){this.#o(),this.#r(),this.scene.environment=null,this.environmentPresetOptions=null;return}if(!this.renderer)throw new Error("init() must run before an environment preset is set");const r=new eh(this.renderer);let a=null,o=null;const l=i===Ln.SKY||i===Ln.GRADIENT;try{if(i===Ln.SKY){o=new br,o.scale.setScalar(this.options.far*.9);const d=t.sunPosition??{x:.4,y:.22,z:-1},c=new U(d.x,d.y,d.z).normalize();this.sunDirection.copy(c),o.material.uniforms.sunPosition.value.copy(c),o.material.uniforms.turbidity.value=Number(t.turbidity??6),o.material.uniforms.rayleigh.value=Number(t.rayleigh??2),o.material.uniforms.mieCoefficient.value=Number(t.mieCoefficient??.005),o.material.uniforms.mieDirectionalG.value=Number(t.mieDirectionalG??.8),a=new Oa,a.add(o)}else if(i===Ln.GRADIENT){const d=su({...t.sky??{},radius:50,sunDirection:t.sunPosition??this.sunDirection});d.material.depthTest=!0,d.material.depthWrite=!0,d.material.toneMapped=!1,d.userData.uniforms.uTime.value=n,d.userData.update(0,this.wind),d.onBeforeRender=()=>{},a=new Oa,a.add(d)}else if(i===Ln.ROOM)a=new ty;else throw new Error(`Unknown environment preset ${String(t.preset)}; expected room, sky, gradient, or none`);const h=r.fromScene(a,.04),u=this.scene.background===this.generatedEnvironment;this.#o(),this.generatedEnvironmentTarget=h,this.generatedEnvironment=h.texture,this.scene.environment=h.texture,this.environmentAge=0,this.scene.environmentRotation.set(0,0,0),e?u&&(this.scene.background=h.texture):l&&t.showSky!==!1?i===Ln.GRADIENT?(this.#s(t),this.skyDome.userData.uniforms.uTime.value=n):this.#a(t):(this.#r(),t.background===void 0&&(this.scene.background=h.texture))}finally{a?.traverse?.(h=>{h.geometry?.dispose?.();const u=Array.isArray(h.material)?h.material:h.material?[h.material]:[];for(const d of u)d.dispose?.()}),r.dispose()}}#s(t){this.#r();const e=su({...t.sky??{},radius:Number(t.sky?.radius??this.options.far*.92),sunDirection:t.sunPosition??this.sunDirection});return t.sunPosition&&this.sunDirection.set(Number(t.sunPosition.x??0),Number(t.sunPosition.y??1),Number(t.sunPosition.z??0)).normalize(),e.userData.setSunDirection(this.sunDirection),this.skyDome=e,this.add(e,"sky"),this.scene.background=null,e}#r(){const t=this.namedRoots.get("sky");t&&(ou(t),this.namedRoots.delete("sky")),this.skyDome=null}#a(t){this.#r();const e=new br;e.scale.setScalar(this.options.far*.9);const i=t.sunPosition??{x:.4,y:.22,z:-1};return this.sunDirection.set(i.x,i.y,i.z).normalize(),e.material.uniforms.sunPosition.value.copy(this.sunDirection),e.material.uniforms.turbidity.value=Number(t.turbidity??6),e.material.uniforms.rayleigh.value=Number(t.rayleigh??2),e.material.uniforms.mieCoefficient.value=Number(t.mieCoefficient??.005),e.material.uniforms.mieDirectionalG.value=Number(t.mieDirectionalG??.8),e.name="A3GameSky",this.skyDome=e,this.add(e,"sky"),this.scene.background=null,e}#o(){this.generatedEnvironment&&(this.scene?.background===this.generatedEnvironment&&(this.scene.background=null),this.generatedEnvironmentTarget?this.generatedEnvironmentTarget.dispose():this.generatedEnvironment.dispose(),this.generatedEnvironmentTarget=null,this.generatedEnvironment=null)}setFog(t={}){if(!this.scene)throw new Error("init() must run before setFog()");const e=t.type??"none";if(e==="none")return this.scene.fog=null,this;const i=new Dt(t.color??1052692);return this.scene.fog=e==="FogExp2"?new Ah(i,t.density??.001):new Rh(i,t.near??1,t.far??200),this}raycastFromPointer(t,e){if(!this.renderer||!this.camera)return null;const i=this.renderer.domElement.getBoundingClientRect();this.pointer.x=(t.clientX-i.left)/i.width*2-1,this.pointer.y=-((t.clientY-i.top)/i.height)*2+1,this.raycaster.setFromCamera(this.pointer,this.camera);const n=this.raycaster.intersectObjects(e??this.scene.children,!0);return n.length>0?n[0]:null}raycast(t,e,i={}){return this.raycaster.set(t,e.clone().normalize()),this.raycaster.near=i.near??0,this.raycaster.far=i.far??1/0,this.raycaster.intersectObjects(i.targets??this.scene.children,!0)}captureFrame(){return this.#i(0),this.renderer?.domElement.toDataURL("image/png")??""}getStats(){const t=this.renderer?.info;return{frameCount:this.frameCount,elapsedSeconds:Number(this.elapsedSeconds.toFixed(3)),simulationSteps:this.lastSubSteps,interpolationAlpha:this.interpolationAlpha,droppedSeconds:this.droppedSeconds,drawCalls:t?.render?.calls??0,triangles:t?.render?.triangles??0,geometries:t?.memory?.geometries??0,textures:t?.memory?.textures??0,programs:t?.programs?.length??0,pixelRatio:this.renderer?.getPixelRatio()??0,size:this.#l()}}dispose(){this.stop(),this.detachControls(),this.tickListeners.clear(),this.renderListeners.clear(),this.interpolatedObjects.clear(),this.sunLights.clear(),this.environmentPresetOptions=null,this.resizeListeners.clear(),this.onWindowResize&&(window.removeEventListener("resize",this.onWindowResize),this.onWindowResize=null),this.resizeObserver?.disconnect(),this.resizeObserver=null,this.#o(),this.skyDome=null,this.scene&&ou(this.scene),this.scene=null,this.namedRoots.clear(),this.renderer&&(this.renderer.dispose(),this.renderer.domElement.remove(),this.renderer=null),this.camera=null}#h(t){this.wind.update(t),this.skyDome?.userData?.update?.(t,this.wind);for(const e of this.tickListeners)e(t,this.elapsedSeconds)}#l(){const t=this.container?.clientWidth||globalThis.window?.innerWidth||1,e=this.container?.clientHeight||globalThis.window?.innerHeight||1;return{width:t,height:e,clientWidth:t,clientHeight:e}}#u(t,e){if(t==="orthographic"){const i=this.options.frustumHeight/2,n=i*e;return new Dh(-n,n,i,-i,this.options.near,this.options.far)}return new ti(this.options.fov,e,this.options.near,this.options.far)}#d(t){if(!this.scene)throw new Error("init() must run before switching cameras");const{width:e,height:i}=this.#l(),n=this.camera,r=this.#u(t,e/Math.max(1,i));if(r.name=n?.name??"A3GameCamera",n){r.position.copy(n.position),r.quaternion.copy(n.quaternion);const a=n.parent;n.removeFromParent?.(),a&&a.add(r)}return this.camera=r,this.controls?.object&&(this.controls.object=r),this.#c(),r}#c(){const{width:t,height:e}=this.#l();if(!this.camera||!this.renderer)return{width:t,height:e};const i=t/Math.max(1,e);if(this.camera.isOrthographicCamera){const n=this.options.frustumHeight/2,r=n*i;this.camera.left=-r,this.camera.right=r,this.camera.top=n,this.camera.bottom=-n}else this.camera.aspect=i;return this.camera.updateProjectionMatrix(),this.renderer.setSize(t,e),{width:t,height:e}}#f(){const t=()=>{const e=this.#c();for(const i of this.resizeListeners)i(e)};this.onWindowResize=t,window.addEventListener("resize",t),typeof ResizeObserver=="function"&&(this.resizeObserver=new ResizeObserver(t),this.resizeObserver.observe(this.container)),t()}}function ou(s){if(!s)return;const t=["map","normalMap","roughnessMap","metalnessMap","aoMap","emissiveMap","alphaMap","displacementMap","envMap","lightMap","clearcoatMap","sheenColorMap"],e=new Set,i=n=>{!n||e.has(n)||n.userData?.a3AssetLibraryOwned||(e.add(n),n.dispose?.())};s.traverse(n=>{if(n.userData?.dispose?.(),n.userData?.disposed)return;n.isLight&&n.dispose?.(),i(n.geometry);const r=Array.isArray(n.material)?n.material:n.material?[n.material]:[];for(const a of r){for(const o of t)i(a[o]);i(a)}}),s.parent?.remove(s),s.clear?.()}const lu="a3game-hud-style",ry=`
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
`,ay=new Set(["top-left","top-center","top-right","center","bottom-left","bottom-center","bottom-right"]),oy=s=>s?typeof s=="string"?document.querySelector(s):s:null;class ly{constructor(t={}){const e=oy(t.container);if(!e)throw new Error("A3GameHudLayer requires an existing container");this.container=e,this.root=document.createElement("div"),this.root.className="a3game-hud-root",this.root.dataset.a3gameHud="root",this.container.appendChild(this.root),this.widgets=new Map,this.slots=new Map,this.fadeTasks=new Map,this.#n()}addText(t,e={}){return this.#e(t,"text",e),this.setValue(t,e.value??""),this.widgets.get(String(t)).element}addBar(t,e={}){const i=this.#e(t,"bar",e);if(i.innerHTML="",e.label){const r=document.createElement("span");r.textContent=String(e.label),i.appendChild(r)}const n=document.createElement("div");return n.className="a3game-hud-bar",n.appendChild(document.createElement("i")),i.appendChild(n),this.setValue(t,Number(e.value??1)),i}addCrosshair(t="crosshair"){const e=this.#e(t,"crosshair",{anchor:"center"});return e.classList.add("a3game-hud-crosshair"),e}addPanel(t,e={}){return this.#e(t,"panel",e),this.setValue(t,e.value??""),this.widgets.get(String(t)).element}addBanner(t,e={}){const i=this.#e(t,"banner",{anchor:e.anchor??"center"});return this.setValue(t,e.value??""),this.setVisible(t,e.visible!==!1),i}setValue(t,e){const i=this.widgets.get(String(t));if(!i)return!1;const{element:n,kind:r}=i;if(r==="bar"){const a=Math.max(0,Math.min(1,Number(e)||0)),o=n.querySelector(".a3game-hud-bar > i");return o&&(o.style.width=`${(a*100).toFixed(1)}%`),n.dataset.a3gameValue=a.toFixed(4),!0}return(r==="text"||r==="panel"||r==="banner")&&(n.textContent=String(e??"")),n.dataset.a3gameValue=String(e??""),!0}setValues(t={}){for(const[e,i]of Object.entries(t))this.setValue(e,i);return this}setVisible(t,e){const i=String(t),n=this.widgets.get(i);return n?(this.fadeTasks.get(i)?.(),n.element.style.display=e?"":"none",n.element.style.opacity=e?"1":"0",n.element.style.pointerEvents="",n.element.dataset.a3gameVisible=e?"true":"false",n.element.dataset.a3gameFaded="false",!0):!1}remove(t){const e=String(t),i=this.widgets.get(e);return i?(this.fadeTasks.get(e)?.(),i.element.remove(),this.widgets.delete(e),!0):!1}autoHide(t,e={}){const i=String(t),n=this.widgets.get(i);if(!n)return()=>{};const r=Number(e.after??6),a=Number(e.fade??.8);if(![r,a].every(c=>Number.isFinite(c)&&c>=0))throw new RangeError("autoHide after/fade must be finite non-negative seconds");if(e.host&&typeof e.host.onRender!="function")throw new TypeError("autoHide host requires onRender");this.setVisible(i,!0),n.element.style.transition="none";let o=0,l=()=>{},h=!1;const u=()=>{h||(h=!0,l(),this.fadeTasks.get(i)===u&&this.fadeTasks.delete(i))},d=c=>{if(h)return;o+=Math.max(0,Number(c)||0);const f=o<r?1:a>0?Math.max(0,1-(o-r)/a):0;n.element.style.opacity=String(f),f<=1e-8&&(n.element.style.display="none",n.element.dataset.a3gameVisible="false",n.element.dataset.a3gameFaded="true",u())};if(this.fadeTasks.set(i,u),e.host)l=e.host.onRender(d);else{let c=performance.now();const f=setInterval(()=>{const g=performance.now();d((g-c)/1e3),c=g},16);l=()=>clearInterval(f)}return d(0),u}getState(){const t={};for(const[e,i]of this.widgets)t[e]={kind:i.kind,value:i.element.dataset.a3gameValue??"",visible:i.element.style.display!=="none"&&i.element.style.opacity!=="0",anchor:i.element.dataset.a3gameAnchor??""};return t}dispose(){for(const t of this.fadeTasks.values())t();this.fadeTasks.clear(),this.widgets.clear(),this.slots.clear(),this.root.remove()}#e(t,e,i){const n=String(t);this.remove(n);const r=ay.has(i.anchor)?i.anchor:"top-left",a=document.createElement("div");return a.className=`a3game-hud-widget ${i.className??""}`.trim(),a.dataset.a3gameWidget=n,a.dataset.a3gameKind=e,a.dataset.a3gameAnchor=r,this.#i(r).appendChild(a),this.widgets.set(n,{element:a,kind:e}),a}#i(t){const e=this.slots.get(t);if(e)return e;const i=document.createElement("div");return i.className="a3game-hud-slot",i.dataset.a3gameAnchor=t,this.root.appendChild(i),this.slots.set(t,i),i}#n(){if(document.getElementById(lu))return;const t=document.createElement("style");t.id=lu,t.textContent=ry,document.head.appendChild(t)}}const nr=(s,t)=>Number.isFinite(Number(s))?Number(s):t,ia=(s,t="")=>typeof s=="string"&&s.length>0?s:t;function hy(s={}){const t=e=>Math.max(-1,Math.min(1,nr(e,0)));return{worldId:ia(s.worldId),participantId:ia(s.participantId),controllerId:ia(s.controllerId),entityId:ia(s.entityId),moveX:t(s.moveX),moveY:t(s.moveY),run:!!s.run,jump:!!s.jump,yaw:nr(s.yaw,0),pitch:nr(s.pitch,0),sequence:Math.trunc(nr(s.sequence,0)),timestampSeconds:nr(s.timestampSeconds,performance.now()/1e3)}}const cy=Object.freeze({KeyW:"forward",ArrowUp:"forward",KeyS:"backward",ArrowDown:"backward",KeyA:"left",ArrowLeft:"left",KeyD:"right",ArrowRight:"right",ShiftLeft:"run",ShiftRight:"run",Space:"jump"}),uy=new Set(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]),Ba=Object.freeze({POINTER_LOCK:"pointer-lock",DRAG:"drag",ALWAYS:"always"});class dy{constructor(t={}){this.target=t.target??window,this.controllerId=String(t.controllerId??""),this.keyBindings={...cy,...t.keyBindings??{}},this.actionBindings={...t.actionBindings??{}},this.pointerSensitivity=Number(t.pointerSensitivity??.0025),this.invertPitch=!!t.invertPitch,this.maxPitch=Number(t.maxPitch??Math.PI/2-.05),this.lookMode=String(t.lookMode??Ba.POINTER_LOCK),this.gamepadIndex=t.gamepadIndex??null,this.axes={forward:0,backward:0,left:0,right:0},this.run=!1,this.jump=!1,this.yaw=0,this.pitch=0,this.sequence=0,this.enabled=!1,this.pointerDown=!1,this.pressedActions=new Set,this.actionListeners=new Set,this.teardown=[]}enable(){if(this.enabled)return this;this.enabled=!0;const t=(e,i,n,r)=>{e.addEventListener(i,n,r),this.teardown.push(()=>e.removeEventListener(i,n,r))};return t(window,"keydown",e=>this.#e(e,!0)),t(window,"keyup",e=>this.#e(e,!1)),t(window,"blur",()=>this.reset()),this.target!==window&&(t(this.target,"pointermove",e=>this.#n(e)),t(this.target,"pointerdown",e=>this.#i(e,!0)),t(this.target,"pointerup",e=>this.#i(e,!1)),t(this.target,"contextmenu",e=>e.preventDefault()),t(window,"pointerup",e=>this.#i(e,!1)),t(window,"pointercancel",()=>{this.pointerDown=!1})),this}disable(){for(const t of this.teardown)t();return this.teardown=[],this.enabled=!1,this.reset(),this}reset(){return this.axes={forward:0,backward:0,left:0,right:0},this.run=!1,this.jump=!1,this.pointerDown=!1,this.pressedActions.clear(),this}setLook(t,e=this.pitch){return this.yaw=Number(t)||0,this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,Number(e)||0)),this}onAction(t){if(typeof t!="function")throw new TypeError("onAction requires a function");return this.actionListeners.add(t),()=>this.actionListeners.delete(t)}isActionHeld(t){return this.pressedActions.has(String(t))}sample(t={}){this.#s();const e=this.axes.forward-this.axes.backward,i=this.axes.right-this.axes.left,n=this.jump;return this.jump=!1,this.sequence+=1,hy({worldId:t.worldId,participantId:t.participantId,controllerId:t.controllerId??this.controllerId,entityId:t.entityId,moveX:i,moveY:e,run:this.run,jump:n,yaw:this.yaw,pitch:this.pitch,sequence:this.sequence})}pipeToSession(t,e,i){return e.onTick(()=>{t.enqueueInputState(this.sample(i))})}#e(t,e){const i=this.keyBindings[t.code];i&&(i==="run"?this.run=e:i==="jump"?(e&&!this.pressedActions.has("jump")&&(this.jump=!0),this.#t("jump",e)):i in this.axes&&(this.axes[i]=e?1:0),uy.has(t.code)&&t.preventDefault());const n=this.actionBindings[t.code];n&&this.#t(n,e)}#i(t,e){this.pointerDown=e?!0:(t.buttons??0)!==0;const i=this.actionBindings[`Mouse${t.button}`]??(t.button===0?"primary":t.button===2?"secondary":"");i&&this.#t(i,e)}#n(t){if(this.lookMode===Ba.POINTER_LOCK){if(!document.pointerLockElement)return}else if(this.lookMode===Ba.DRAG&&!this.pointerDown)return;const e=Number(t.movementX??0),i=Number(t.movementY??0);if(e===0&&i===0)return;this.yaw-=e*this.pointerSensitivity;const n=this.invertPitch?1:-1;this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,this.pitch+n*i*this.pointerSensitivity))}#t(t,e){const i=String(t),n=this.pressedActions.has(i);if(e&&!n){this.pressedActions.add(i);for(const r of this.actionListeners)r(i,"pressed")}else if(!e&&n){this.pressedActions.delete(i);for(const r of this.actionListeners)r(i,"released")}}#s(){if(this.gamepadIndex===null)return;const e=(navigator.getGamepads?.()??[])[this.gamepadIndex];if(!e)return;const i=.15,n=o=>Math.abs(o)<i?0:o,r=n(e.axes[0]??0),a=n(e.axes[1]??0);this.axes.right=Math.max(0,r),this.axes.left=Math.max(0,-r),this.axes.forward=Math.max(0,-a),this.axes.backward=Math.max(0,a),this.yaw-=n(e.axes[2]??0)*.04,this.pitch=Math.max(-this.maxPitch,Math.min(this.maxPitch,this.pitch-n(e.axes[3]??0)*.04)),this.run=!!e.buttons[10]?.pressed,e.buttons[0]?.pressed&&!this.pressedActions.has("jump")&&(this.jump=!0),this.#t("jump",!!e.buttons[0]?.pressed),this.#t("primary",!!e.buttons[7]?.pressed),this.#t("secondary",!!e.buttons[6]?.pressed)}}class fy{constructor(){this.ctx=null,this.muted=!1,this.nextDrip=2,this.nextTwinkle=1.5,this.charge=null}unlock(){if(this.ctx){this.ctx.state==="suspended"&&this.ctx.resume();return}const t=globalThis.AudioContext??globalThis.webkitAudioContext;if(!t)return;const e=new t;this.ctx=e,this.master=e.createGain(),this.master.gain.value=.8,this.master.connect(e.destination),this.dry=e.createGain(),this.dry.connect(this.master),this.reverb=e.createConvolver(),this.reverb.buffer=this.#e(3.2,2.6),this.wet=e.createGain(),this.wet.gain.value=.55,this.reverb.connect(this.wet).connect(this.master),this.#s()}setMuted(t){this.muted=t,this.master&&this.master.gain.setTargetAtTime(t?0:.8,this.ctx.currentTime,.05)}#e(t,e){const{ctx:i}=this,n=Math.floor(i.sampleRate*t),r=i.createBuffer(2,n,i.sampleRate);for(let a=0;a<2;a+=1){const o=r.getChannelData(a);for(let l=0;l<n;l+=1)o[l]=(Math.random()*2-1)*(1-l/n)**e}return r}#i(t){const{ctx:e}=this,i=Math.floor(e.sampleRate*t),n=e.createBuffer(1,i,e.sampleRate),r=n.getChannelData(0);let a=0;for(let o=0;o<i;o+=1)a=(a+.02*(Math.random()*2-1))/1.02,r[o]=a*3.5;return n}#n(t,{pan:e=0,wet:i=.5,dry:n=1}={}){const{ctx:r}=this,a=r.createStereoPanner();a.pan.value=Math.max(-1,Math.min(1,e)),t.connect(a);const o=r.createGain();o.gain.value=n;const l=r.createGain();l.gain.value=i,a.connect(o).connect(this.dry),a.connect(l).connect(this.reverb)}#t({type:t="sine",f0:e,f1:i=e,t:n=0,dur:r,gain:a,attack:o=.005,pan:l=0,wet:h=.5}){const{ctx:u}=this,d=u.currentTime+n,c=u.createOscillator();c.type=t,c.frequency.setValueAtTime(e,d),i!==e&&c.frequency.exponentialRampToValueAtTime(Math.max(20,i),d+r);const f=u.createGain();f.gain.setValueAtTime(1e-4,d),f.gain.exponentialRampToValueAtTime(a,d+o),f.gain.exponentialRampToValueAtTime(1e-4,d+r),c.connect(f),this.#n(f,{pan:l,wet:h}),c.start(d),c.stop(d+r+.05)}#s(){const{ctx:t}=this,e=t.createGain();e.gain.value=.05;for(const a of[55,55.6,82.4]){const o=t.createOscillator();o.frequency.value=a,o.connect(e),o.start()}const i=t.createBufferSource();i.buffer=this.#i(4),i.loop=!0;const n=t.createBiquadFilter();n.type="lowpass",n.frequency.value=220;const r=t.createGain();r.gain.value=.06,i.connect(n).connect(r).connect(this.master),i.start(),e.connect(this.master)}pulse(t,e){if(!this.ctx)return;if(this.stopCharge(),t==="tap"){this.#t({f0:2100,f1:1500,dur:.09,gain:.12,wet:.35}),this.#t({f0:1500,f1:1200,t:.16,dur:.07,gain:.03,wet:.6});return}const i=.12+e*.2;this.#t({f0:1300,f1:520,dur:.5,gain:i,wet:.8}),this.#t({type:"triangle",f0:260,f1:110,dur:.6,gain:i*.7,wet:.6});for(let n=1;n<=3;n+=1)this.#t({f0:1100-n*120,f1:500,t:.22*n+e*.2,dur:.35,gain:i*.35/n,pan:n%2?-.5:.5,wet:1})}startCharge(){if(!this.ctx||this.charge)return;const{ctx:t}=this,e=t.createOscillator();e.type="sine",e.frequency.setValueAtTime(300,t.currentTime),e.frequency.linearRampToValueAtTime(900,t.currentTime+1.1);const i=t.createGain();i.gain.setValueAtTime(1e-4,t.currentTime),i.gain.exponentialRampToValueAtTime(.05,t.currentTime+.25),e.connect(i),this.#n(i,{wet:.3}),e.start(),this.charge={o:e,g:i}}stopCharge(){if(!this.charge)return;const{o:t,g:e}=this.charge,i=this.ctx.currentTime;e.gain.cancelScheduledValues(i),e.gain.setTargetAtTime(1e-4,i,.02),t.stop(i+.15),this.charge=null}growl({pan:t=0,distance:e=5,short:i=!1}={}){if(!this.ctx)return;const{ctx:n}=this,r=n.currentTime,a=i?.5:1.4,o=Math.max(.08,.45-e*.015),l=n.createOscillator();l.type="sawtooth",l.frequency.setValueAtTime(i?95:58,r),l.frequency.linearRampToValueAtTime(i?70:82,r+a*.6),l.frequency.linearRampToValueAtTime(48,r+a);const h=n.createOscillator();h.frequency.value=23;const u=n.createGain();u.gain.value=18,h.connect(u).connect(l.frequency);const d=n.createBufferSource();d.buffer=this.#i(a+.1);const c=n.createBiquadFilter();c.type="lowpass",c.frequency.value=520;const f=n.createGain();f.gain.setValueAtTime(1e-4,r),f.gain.exponentialRampToValueAtTime(o,r+.12),f.gain.exponentialRampToValueAtTime(1e-4,r+a),l.connect(c),d.connect(c),c.connect(f),this.#n(f,{pan:t,wet:.5});for(const g of[l,h,d])g.start(r),g.stop(r+a+.1)}chime(t=0){if(!this.ctx)return;const e=1318.5*2**(t/12);[1,1.26,1.5,2].forEach((i,n)=>this.#t({f0:e*i,dur:1.2,gain:.08,t:n*.07,wet:.8}))}twinkle({pan:t=0,distance:e=10}){if(!this.ctx)return;const i=Math.max(.004,.05*(1-e/20));this.#t({f0:2637,dur:.4,gain:i,pan:t,wet:.9}),this.#t({f0:3322,t:.09,dur:.35,gain:i*.7,pan:t,wet:.9})}checkpoint(){this.ctx&&[523.3,659.3,784].forEach(t=>this.#t({type:"triangle",f0:t,dur:1.6,gain:.06,attack:.08,wet:.8}))}exitOpened(){this.ctx&&[392,523.3,659.3,784,1046.5].forEach((t,e)=>this.#t({type:"triangle",f0:t,t:e*.18,dur:2.2,gain:.07,attack:.1,wet:.9}))}caught(){this.ctx&&(this.growl({short:!0,distance:0}),this.#t({type:"sine",f0:120,f1:30,dur:.9,gain:.5,wet:.4}))}win(){this.ctx&&[523.3,659.3,784,1046.5,1318.5,1568].forEach((t,e)=>this.#t({f0:t,t:e*.12,dur:1.8,gain:.07,wet:.9}))}update(t,{playing:e,nearestMoth:i}){if(!(!this.ctx||!e)){if(this.nextDrip-=t,this.nextDrip<=0){this.nextDrip=1.2+Math.random()*3.8;const n=1400+Math.random()*900;this.#t({f0:n,f1:n*.45,dur:.12,gain:.02+Math.random()*.03,pan:Math.random()*2-1,wet:1})}this.nextTwinkle-=t,this.nextTwinkle<=0&&(this.nextTwinkle=2.2+Math.random(),i&&i.distance<20&&this.twinkle(i))}}}const Er=2,py=["################################################","####.....#######################....############","###...M...######.......#######.......###########","###.......####....B.....#####....M....##########","####..##..###...........####.....##...##########","#####.##..##.....###.....##.....####..##########","#####.....#....C.###...........#####..##########","######...##.......#....######..####...##########","#######.###..##........#######.......###########","#######.###..####...##########...#.....#########","######...#..######.###########..###..B..########","##.......#.#######.##########..####......#######","#...##.....######...########..#####..##..#######","#.M.##.B...#####.....######..######..##...######","#...........####..S..#####..#######.......######","##..####....####.....####..#######...####..#####","###.####..#######...####..#######..C.####..#####","###......########...###..#######...########.####","####....#########...##..#######..##########.####","#######.########.....#..######..###########.####","#######..######...##.......###.####...#####.####","########..####...####...B...#..###..M..###..####","#########..##...######.......#.##........#..####","##########.....#######..##...C...#..##..B...####","###########...#########.##...##.....##.......###","#############.##########....####...####...E..###","#############.M..############.....#####......###","##################..........................####","################################################"],hu="#";function my(s=py){const t=s.length,e=Math.max(...s.map(r=>r.length)),i=new Uint8Array(e*t),n={width:e,height:t,cell:Er,solid:i,start:null,checkpoints:[],moths:[],beasts:[],exit:null};for(let r=0;r<t;r+=1)for(let a=0;a<e;a+=1){const o=s[r][a]??hu;i[r*e+a]=o===hu?1:0;const l=Nd(a,r),h={col:a,row:r,x:l.x,z:l.z};o==="S"?(n.start=h,n.checkpoints.unshift({...h,id:"cp_0"})):o==="C"?n.checkpoints.push({...h,id:`cp_${n.checkpoints.length+1}`}):o==="M"?n.moths.push({...h,id:`moth_${n.moths.length+1}`}):o==="B"?n.beasts.push({...h,id:`beast_${n.beasts.length+1}`}):o==="E"&&(n.exit=h)}return n.checkpoints.forEach((r,a)=>{r.id=`cp_${a}`}),n}function Nd(s,t){return{x:(s+.5)*Er,z:(t+.5)*Er}}function Ya(s,t){return{col:Math.floor(s/Er),row:Math.floor(t/Er)}}function Ii(s,t,e){return t<0||e<0||t>=s.width||e>=s.height?!0:s.solid[e*s.width+t]===1}function Fd(s,t,e,i=4e3){if(Ii(s,e.col,e.row))return null;const n=s.width,r=(f,g)=>g*n+f,a=new Int32Array(n*s.height).fill(-2),o=r(t.col,t.row),l=r(e.col,e.row);a[o]=-1;const h=[o];let u=0;const d=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];for(;u<h.length&&u<i;){const f=h[u++];if(f===l)break;const g=f%n,_=(f-g)/n;for(const[m,p]of d){const v=g+m,E=_+p;if(Ii(s,v,E)||m&&p&&(Ii(s,g+m,_)||Ii(s,g,_+p)))continue;const M=r(v,E);a[M]===-2&&(a[M]=f,h.push(M))}}if(a[l]===-2)return null;const c=[];for(let f=l;f!==o&&f!==-1;f=a[f]){const g=f%n;c.push({col:g,row:(f-g)/n})}return c.reverse()}const gy=Object.freeze({playerSpeed:3.6,playerRadius:.35,tapRadius:4,fullRadius:25,tapThreshold:.18,chargeTime:.9,pulseCooldown:.3,pulseSpeed:22,echoFade:2,beastRadius:.5,beastSpeed:3.1,beastLungeSpeed:3.9,beastRouse:.7,beastSearch:3,beastSenseRadius:2.4,catchRadius:.85,mothRadius:1.1,checkpointRadius:1.5,exitRadius:1.6,mothsRequired:5}),$t=Object.freeze({TITLE:"title",PLAYING:"playing",PAUSED:"paused",CAUGHT:"caught",WON:"won"}),Re=Object.freeze({SLEEPING:"sleeping",ROUSING:"rousing",HUNTING:"hunting",SEARCHING:"searching",LUNGING:"lunging"});class xy{constructor({rows:t,tuning:e}={}){this.level=my(t),this.tuning={...gy,...e??{}},this.listeners=new Map,this.clock=0,this.resetRun(),this.phase=$t.TITLE}on(t,e){return this.listeners.has(t)||this.listeners.set(t,new Set),this.listeners.get(t).add(e),()=>this.listeners.get(t)?.delete(e)}emit(t,e={}){for(const i of this.listeners.get(t)??[])i(e);for(const i of this.listeners.get("*")??[])i(t,e)}resetRun(){const{level:t}=this;this.player={x:t.start.x,z:t.start.z,vx:0,vz:0,facing:0},this.checkpointIndex=0,this.checkpoints=t.checkpoints.map(e=>({...e,active:e.id==="cp_0"})),this.moths=t.moths.map(e=>({...e,collected:!1})),this.beasts=t.beasts.map(e=>this.#e(e)),this.exitOpen=!1,this.pulses=[],this.charge=null,this.cooldown=0,this.runTime=0,this.stats={tapPulses:0,fullPulses:0,deaths:0},this.lastPulse=null,this.result=null}#e(t){return{id:t.id,homeX:t.x,homeZ:t.z,x:t.x,z:t.z,state:Re.SLEEPING,timer:0,target:null,path:[],facing:0}}#i(t){if(this.phase===t)return;const e=this.phase;this.phase=t,this.emit("phase",{from:e,to:t})}start(){return this.phase!==$t.TITLE&&this.phase!==$t.WON?!1:(this.resetRun(),this.#i($t.PLAYING),this.emit("start",{}),!0)}restart(){return this.phase=$t.TITLE,this.start()}pause(){return this.phase!==$t.PLAYING?!1:(this.charge=null,this.#i($t.PAUSED),!0)}resume(){return this.phase!==$t.PAUSED?!1:(this.#i($t.PLAYING),!0)}togglePause(){return this.phase===$t.PAUSED?this.resume():this.pause()}respawn(){if(this.phase!==$t.CAUGHT)return!1;const t=this.checkpoints[this.checkpointIndex];return this.player.x=t.x,this.player.z=t.z,this.player.vx=0,this.player.vz=0,this.beasts=this.level.beasts.map(e=>this.#e(e)),this.charge=null,this.cooldown=0,this.#i($t.PLAYING),this.emit("respawn",{checkpoint:t.id,x:t.x,z:t.z}),!0}beginCharge(){return this.phase!==$t.PLAYING||this.charge!==null?!1:(this.charge=0,this.emit("chargeStart",{}),!0)}releasePulse(){if(this.phase!==$t.PLAYING||this.charge===null)return null;const t=this.charge;return this.charge=null,this.cooldown>0?(this.emit("pulseBlocked",{}),null):this.emitPulse(this.chargeRadius(t))}chargeRadius(t=this.charge??0){const{tapRadius:e,fullRadius:i,tapThreshold:n,chargeTime:r}=this.tuning,a=Math.min(1,Math.max(0,(t-n)/r));return e+(i-e)*a}emitPulse(t){const{tapRadius:e,fullRadius:i,pulseCooldown:n}=this.tuning,r=Math.min(i,Math.max(e,t)),a=r<=e+.01?"tap":r>=i-.01?"full":"mid",o={x:this.player.x,z:this.player.z,radius:r,time:this.clock,kind:a};return this.pulses.push(o),this.pulses.length>8&&this.pulses.shift(),a==="tap"?this.stats.tapPulses+=1:this.stats.fullPulses+=1,this.cooldown=n,this.lastPulse=o,this.emit("pulse",{...o,loudness:r/i}),this.#n(o),o}#n(t){for(const e of this.beasts){const i=Math.hypot(e.x-t.x,e.z-t.z);i>t.radius||(e.target={x:t.x,z:t.z},e.path=this.#t(e,e.target),e.state===Re.SLEEPING?(e.state=Re.ROUSING,e.timer=this.tuning.beastRouse,this.emit("beastWake",{id:e.id,x:e.x,z:e.z,distance:i})):e.state!==Re.ROUSING&&(e.state=Re.HUNTING,this.emit("beastHunt",{id:e.id,x:e.x,z:e.z})))}}#t(t,e){return Fd(this.level,Ya(t.x,t.z),Ya(e.x,e.z))??[]}update(t,e={}){this.clock+=t;const i=this.tuning.fullRadius/this.tuning.pulseSpeed+this.tuning.echoFade+.2;this.pulses=this.pulses.filter(n=>this.clock-n.time<i),this.phase===$t.PLAYING&&(this.runTime+=t,this.cooldown=Math.max(0,this.cooldown-t),this.charge!==null&&(this.charge+=t),this.#s(t,e),this.#r(t),this.phase===$t.PLAYING&&this.#h())}#s(t,e){let i=Number(e.moveX)||0,n=-(Number(e.moveY)||0);const r=Math.hypot(i,n);r>1&&(i/=r,n/=r);const a=this.tuning.playerSpeed*(this.charge!==null?.6:1),o=this.player;o.vx=i*a,o.vz=n*a,r>.01&&(o.facing=Math.atan2(i,n));const l=this.resolveCircle(o.x+o.vx*t,o.z+o.vz*t,this.tuning.playerRadius);o.x=l.x,o.z=l.z}resolveCircle(t,e,i){const n=this.level.cell;for(let r=0;r<3;r+=1){const a=Math.floor((t-i)/n),o=Math.floor((t+i)/n),l=Math.floor((e-i)/n),h=Math.floor((e+i)/n);let u=!1;for(let d=l;d<=h;d+=1)for(let c=a;c<=o;c+=1){if(!Ii(this.level,c,d))continue;const f=Math.max(c*n,Math.min(t,(c+1)*n)),g=Math.max(d*n,Math.min(e,(d+1)*n)),_=t-f,m=e-g,p=Math.hypot(_,m);if(!(p>=i)){if(p<1e-6){const v=(c+.5)*n,E=(d+.5)*n;Math.abs(t-v)>Math.abs(e-E)?t=t>v?(c+1)*n+i:c*n-i:e=e>E?(d+1)*n+i:d*n-i}else t=f+_/p*i,e=g+m/p*i;u=!0}}if(!u)break}return{x:t,z:e}}#r(t){const e=this.tuning,i=this.player;for(const n of this.beasts){if(n.state===Re.SLEEPING)continue;if(n.state===Re.ROUSING){n.timer-=t,n.timer<=0&&(n.state=Re.HUNTING);continue}if(Math.hypot(i.x-n.x,i.z-n.z)<e.beastSenseRadius?(n.state!==Re.LUNGING&&this.emit("beastLunge",{id:n.id}),n.state=Re.LUNGING):n.state===Re.LUNGING&&(n.state=Re.SEARCHING,n.timer=e.beastSearch),n.state===Re.LUNGING)this.#a(n,i.x,i.z,e.beastLungeSpeed*t);else if(n.state===Re.HUNTING){const a=n.path[0];if(!a)n.state=Re.SEARCHING,n.timer=e.beastSearch;else{const o=Nd(a.col,a.row),l=n.path.length===1,h=l&&n.target?n.target.x:o.x,u=l&&n.target?n.target.z:o.z;this.#a(n,h,u,e.beastSpeed*t)<.25&&n.path.shift()}}else n.state===Re.SEARCHING&&(n.timer-=t,n.facing+=t*1.5,n.timer<=0&&(n.state=Re.SLEEPING,n.target=null,this.emit("beastSettle",{id:n.id,x:n.x,z:n.z})));if(Math.hypot(i.x-n.x,i.z-n.z)<e.catchRadius){this.#o(n);return}}}#a(t,e,i,n){const r=e-t.x,a=i-t.z,o=Math.hypot(r,a);if(o>1e-4){const l=Math.min(1,n/o),h=this.resolveCircle(t.x+r*l,t.z+a*l,this.tuning.beastRadius);t.x=h.x,t.z=h.z,t.facing=Math.atan2(r,a)}return Math.hypot(e-t.x,i-t.z)}#o(t){this.stats.deaths+=1,this.charge=null,this.#i($t.CAUGHT),this.emit("caught",{by:t.id,x:this.player.x,z:this.player.z})}#h(){const t=this.tuning,e=this.player;for(const n of this.moths){if(n.collected||Math.hypot(n.x-e.x,n.z-e.z)>t.mothRadius)continue;n.collected=!0;const r=this.mothsCollected();this.emit("mothCollected",{id:n.id,count:r,required:t.mothsRequired,x:n.x,z:n.z}),r>=t.mothsRequired&&!this.exitOpen&&(this.exitOpen=!0,this.emit("exitOpened",{x:this.level.exit.x,z:this.level.exit.z}))}this.checkpoints.forEach((n,r)=>{n.active||Math.hypot(n.x-e.x,n.z-e.z)>t.checkpointRadius||(n.active=!0,this.checkpointIndex=r,this.emit("checkpoint",{id:n.id,x:n.x,z:n.z}))}),this.checkpoints.forEach((n,r)=>{n.active&&r!==this.checkpointIndex&&Math.hypot(n.x-e.x,n.z-e.z)<t.checkpointRadius&&(this.checkpointIndex=r)});const i=this.level.exit;this.exitOpen&&Math.hypot(i.x-e.x,i.z-e.z)<t.exitRadius&&(this.result={time:this.runTime,pulses:this.stats.tapPulses+this.stats.fullPulses,tapPulses:this.stats.tapPulses,fullPulses:this.stats.fullPulses,deaths:this.stats.deaths},this.#i($t.WON),this.emit("won",this.result))}mothsCollected(){return this.moths.reduce((t,e)=>t+(e.collected?1:0),0)}getState(){return{phase:this.phase,clock:this.clock,runTime:this.runTime,player:{x:this.player.x,z:this.player.z,facing:this.player.facing},charging:this.charge!==null,chargeRadius:this.charge!==null?this.chargeRadius():0,cooldown:this.cooldown,mothsCollected:this.mothsCollected(),mothsRequired:this.tuning.mothsRequired,moths:this.moths.map(t=>({id:t.id,x:t.x,z:t.z,collected:t.collected})),beasts:this.beasts.map(t=>({id:t.id,x:t.x,z:t.z,state:t.state,awake:t.state!==Re.SLEEPING})),checkpoint:this.checkpoints[this.checkpointIndex].id,checkpoints:this.checkpoints.map(t=>({id:t.id,x:t.x,z:t.z,active:t.active})),exit:{x:this.level.exit.x,z:this.level.exit.z,open:this.exitOpen},stats:{...this.stats,pulses:this.stats.tapPulses+this.stats.fullPulses},result:this.result}}}/**
 * @license
 * Copyright 2010-2026 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Ud="185",sh=0,_y=1,cu=2,uu=1,ka=2,du=100,fu=204,pu=205,mu=3,yy=0,Od=300,gu=1e3,na=1001,xu=1002,My=1006,vy=1008,Sy=1009,by=1015,Ey=1023,zd="",ai="srgb",_u="srgb-linear",yu="linear",Bo="srgb",ps=7680,Mu=519,rh=35044,sa=2e3,vu=2001;function wy(s){for(let t=s.length-1;t>=0;--t)if(s[t]>=65535)return!0;return!1}function Su(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}const bu={};function Eu(...s){const t="THREE."+s.shift();console.log(t,...s)}function Bd(s){const t=s[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=s[1];e&&e.isStackTrace?s[0]+=" "+e.getLocation():s[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return s}function be(...s){s=Bd(s);const t="THREE."+s.shift();{const e=s[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...s)}}function yn(...s){s=Bd(s);const t="THREE."+s.shift();{const e=s[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...s)}}function _r(...s){const t=s.join(" ");t in bu||(bu[t]=!0,be(...s))}class Tr{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(e)===-1&&i[t].push(e)}hasEventListener(t,e){const i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(e)!==-1}removeEventListener(t,e){const i=this._listeners;if(i===void 0)return;const n=i[t];if(n!==void 0){const r=n.indexOf(e);r!==-1&&n.splice(r,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const i=e[t.type];if(i!==void 0){t.target=this;const n=i.slice(0);for(let r=0,a=n.length;r<a;r++)n[r].call(this,t);t.target=null}}}const Oe=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Ty=Math.PI/180;function vn(){const s=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(Oe[s&255]+Oe[s>>8&255]+Oe[s>>16&255]+Oe[s>>24&255]+"-"+Oe[t&255]+Oe[t>>8&255]+"-"+Oe[t>>16&15|64]+Oe[t>>24&255]+"-"+Oe[e&63|128]+Oe[e>>8&255]+"-"+Oe[e>>16&255]+Oe[e>>24&255]+Oe[i&255]+Oe[i>>8&255]+Oe[i>>16&255]+Oe[i>>24&255]).toLowerCase()}function Vt(s,t,e){return Math.max(t,Math.min(e,s))}function Ay(s,t){return(s%t+t)%t}function ko(s,t,e){return(1-e)*s+e*t}function Pi(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function Qt(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}class re{static{re.prototype.isVector2=!0}constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,i=this.y,n=t.elements;return this.x=n[0]*e+n[3]*i+n[6],this.y=n[1]*e+n[4]*i+n[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Vt(this.x,t.x,e.x),this.y=Vt(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Vt(this.x,t,e),this.y=Vt(this.y,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Vt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Vt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y;return e*e+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const i=Math.cos(e),n=Math.sin(e),r=this.x-t.x,a=this.y-t.y;return this.x=r*i-a*n+t.x,this.y=r*n+a*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Ar{constructor(t=0,e=0,i=0,n=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=i,this._w=n}static slerpFlat(t,e,i,n,r,a,o){let l=i[n+0],h=i[n+1],u=i[n+2],d=i[n+3],c=r[a+0],f=r[a+1],g=r[a+2],_=r[a+3];if(d!==_||l!==c||h!==f||u!==g){let m=l*c+h*f+u*g+d*_;m<0&&(c=-c,f=-f,g=-g,_=-_,m=-m);let p=1-o;if(m<.9995){const v=Math.acos(m),E=Math.sin(v);p=Math.sin(p*v)/E,o=Math.sin(o*v)/E,l=l*p+c*o,h=h*p+f*o,u=u*p+g*o,d=d*p+_*o}else{l=l*p+c*o,h=h*p+f*o,u=u*p+g*o,d=d*p+_*o;const v=1/Math.sqrt(l*l+h*h+u*u+d*d);l*=v,h*=v,u*=v,d*=v}}t[e]=l,t[e+1]=h,t[e+2]=u,t[e+3]=d}static multiplyQuaternionsFlat(t,e,i,n,r,a){const o=i[n],l=i[n+1],h=i[n+2],u=i[n+3],d=r[a],c=r[a+1],f=r[a+2],g=r[a+3];return t[e]=o*g+u*d+l*f-h*c,t[e+1]=l*g+u*c+h*d-o*f,t[e+2]=h*g+u*f+o*c-l*d,t[e+3]=u*g-o*d-l*c-h*f,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,i,n){return this._x=t,this._y=e,this._z=i,this._w=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const i=t._x,n=t._y,r=t._z,a=t._order,o=Math.cos,l=Math.sin,h=o(i/2),u=o(n/2),d=o(r/2),c=l(i/2),f=l(n/2),g=l(r/2);switch(a){case"XYZ":this._x=c*u*d+h*f*g,this._y=h*f*d-c*u*g,this._z=h*u*g+c*f*d,this._w=h*u*d-c*f*g;break;case"YXZ":this._x=c*u*d+h*f*g,this._y=h*f*d-c*u*g,this._z=h*u*g-c*f*d,this._w=h*u*d+c*f*g;break;case"ZXY":this._x=c*u*d-h*f*g,this._y=h*f*d+c*u*g,this._z=h*u*g+c*f*d,this._w=h*u*d-c*f*g;break;case"ZYX":this._x=c*u*d-h*f*g,this._y=h*f*d+c*u*g,this._z=h*u*g-c*f*d,this._w=h*u*d+c*f*g;break;case"YZX":this._x=c*u*d+h*f*g,this._y=h*f*d+c*u*g,this._z=h*u*g-c*f*d,this._w=h*u*d-c*f*g;break;case"XZY":this._x=c*u*d-h*f*g,this._y=h*f*d-c*u*g,this._z=h*u*g+c*f*d,this._w=h*u*d+c*f*g;break;default:be("Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const i=e/2,n=Math.sin(i);return this._x=t.x*n,this._y=t.y*n,this._z=t.z*n,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,i=e[0],n=e[4],r=e[8],a=e[1],o=e[5],l=e[9],h=e[2],u=e[6],d=e[10],c=i+o+d;if(c>0){const f=.5/Math.sqrt(c+1);this._w=.25/f,this._x=(u-l)*f,this._y=(r-h)*f,this._z=(a-n)*f}else if(i>o&&i>d){const f=2*Math.sqrt(1+i-o-d);this._w=(u-l)/f,this._x=.25*f,this._y=(n+a)/f,this._z=(r+h)/f}else if(o>d){const f=2*Math.sqrt(1+o-i-d);this._w=(r-h)/f,this._x=(n+a)/f,this._y=.25*f,this._z=(l+u)/f}else{const f=2*Math.sqrt(1+d-i-o);this._w=(a-n)/f,this._x=(r+h)/f,this._y=(l+u)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let i=t.dot(e)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Vt(this.dot(t),-1,1)))}rotateTowards(t,e){const i=this.angleTo(t);if(i===0)return this;const n=Math.min(1,e/i);return this.slerp(t,n),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const i=t._x,n=t._y,r=t._z,a=t._w,o=e._x,l=e._y,h=e._z,u=e._w;return this._x=i*u+a*o+n*h-r*l,this._y=n*u+a*l+r*o-i*h,this._z=r*u+a*h+i*l-n*o,this._w=a*u-i*o-n*l-r*h,this._onChangeCallback(),this}slerp(t,e){let i=t._x,n=t._y,r=t._z,a=t._w,o=this.dot(t);o<0&&(i=-i,n=-n,r=-r,a=-a,o=-o);let l=1-e;if(o<.9995){const h=Math.acos(o),u=Math.sin(h);l=Math.sin(l*h)/u,e=Math.sin(e*h)/u,this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+r*e,this._w=this._w*l+a*e,this._onChangeCallback()}else this._x=this._x*l+i*e,this._y=this._y*l+n*e,this._z=this._z*l+r*e,this._w=this._w*l+a*e,this.normalize();return this}slerpQuaternions(t,e,i){return this.copy(t).slerp(e,i)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),i=Math.random(),n=Math.sqrt(1-i),r=Math.sqrt(i);return this.set(n*Math.sin(t),n*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class W{static{W.prototype.isVector3=!0}constructor(t=0,e=0,i=0){this.x=t,this.y=e,this.z=i}set(t,e,i){return i===void 0&&(i=this.z),this.x=t,this.y=e,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(wu.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(wu.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,i=this.y,n=this.z,r=t.elements;return this.x=r[0]*e+r[3]*i+r[6]*n,this.y=r[1]*e+r[4]*i+r[7]*n,this.z=r[2]*e+r[5]*i+r[8]*n,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,r=t.elements,a=1/(r[3]*e+r[7]*i+r[11]*n+r[15]);return this.x=(r[0]*e+r[4]*i+r[8]*n+r[12])*a,this.y=(r[1]*e+r[5]*i+r[9]*n+r[13])*a,this.z=(r[2]*e+r[6]*i+r[10]*n+r[14])*a,this}applyQuaternion(t){const e=this.x,i=this.y,n=this.z,r=t.x,a=t.y,o=t.z,l=t.w,h=2*(a*n-o*i),u=2*(o*e-r*n),d=2*(r*i-a*e);return this.x=e+l*h+a*d-o*u,this.y=i+l*u+o*h-r*d,this.z=n+l*d+r*u-a*h,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,i=this.y,n=this.z,r=t.elements;return this.x=r[0]*e+r[4]*i+r[8]*n,this.y=r[1]*e+r[5]*i+r[9]*n,this.z=r[2]*e+r[6]*i+r[10]*n,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Vt(this.x,t.x,e.x),this.y=Vt(this.y,t.y,e.y),this.z=Vt(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Vt(this.x,t,e),this.y=Vt(this.y,t,e),this.z=Vt(this.z,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Vt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const i=t.x,n=t.y,r=t.z,a=e.x,o=e.y,l=e.z;return this.x=n*l-r*o,this.y=r*a-i*l,this.z=i*o-n*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const i=t.dot(this)/e;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return Vo.copy(this).projectOnVector(t),this.sub(Vo)}reflect(t){return this.sub(Vo.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const i=this.dot(t)/e;return Math.acos(Vt(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,i=this.y-t.y,n=this.z-t.z;return e*e+i*i+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,i){const n=Math.sin(e)*t;return this.x=n*Math.sin(i),this.y=Math.cos(e)*t,this.z=n*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,i){return this.x=t*Math.sin(e),this.y=i,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),n=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=i,this.z=n,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,i=Math.sqrt(1-e*e);return this.x=i*Math.cos(t),this.y=e,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const Vo=new W,wu=new Ar;class tn{static{tn.prototype.isMatrix3=!0}constructor(t,e,i,n,r,a,o,l,h){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,i,n,r,a,o,l,h)}set(t,e,i,n,r,a,o,l,h){const u=this.elements;return u[0]=t,u[1]=n,u[2]=o,u[3]=e,u[4]=r,u[5]=l,u[6]=i,u[7]=a,u[8]=h,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],this}extractBasis(t,e,i){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,r=this.elements,a=i[0],o=i[3],l=i[6],h=i[1],u=i[4],d=i[7],c=i[2],f=i[5],g=i[8],_=n[0],m=n[3],p=n[6],v=n[1],E=n[4],M=n[7],T=n[2],b=n[5],A=n[8];return r[0]=a*_+o*v+l*T,r[3]=a*m+o*E+l*b,r[6]=a*p+o*M+l*A,r[1]=h*_+u*v+d*T,r[4]=h*m+u*E+d*b,r[7]=h*p+u*M+d*A,r[2]=c*_+f*v+g*T,r[5]=c*m+f*E+g*b,r[8]=c*p+f*M+g*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[1],n=t[2],r=t[3],a=t[4],o=t[5],l=t[6],h=t[7],u=t[8];return e*a*u-e*o*h-i*r*u+i*o*l+n*r*h-n*a*l}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],r=t[3],a=t[4],o=t[5],l=t[6],h=t[7],u=t[8],d=u*a-o*h,c=o*l-u*r,f=h*r-a*l,g=e*d+i*c+n*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return t[0]=d*_,t[1]=(n*h-u*i)*_,t[2]=(o*i-n*a)*_,t[3]=c*_,t[4]=(u*e-n*l)*_,t[5]=(n*r-o*e)*_,t[6]=f*_,t[7]=(i*l-h*e)*_,t[8]=(a*e-i*r)*_,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,i,n,r,a,o){const l=Math.cos(r),h=Math.sin(r);return this.set(i*l,i*h,-i*(l*a+h*o)+a+t,-n*h,n*l,-n*(-h*a+l*o)+o+e,0,0,1),this}scale(t,e){return _r("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(Go.makeScale(t,e)),this}rotate(t){return _r("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(Go.makeRotation(-t)),this}translate(t,e){return _r("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(Go.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,i,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<9;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<9;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const Go=new tn,Tu=new tn().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Au=new tn().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Ry(){const s={enabled:!0,workingColorSpace:_u,spaces:{},convert:function(n,r,a){return this.enabled===!1||r===a||!r||!a||(this.spaces[r].transfer===Bo&&(n.r=Ji(n.r),n.g=Ji(n.g),n.b=Ji(n.b)),this.spaces[r].primaries!==this.spaces[a].primaries&&(n.applyMatrix3(this.spaces[r].toXYZ),n.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===Bo&&(n.r=Bs(n.r),n.g=Bs(n.g),n.b=Bs(n.b))),n},workingToColorSpace:function(n,r){return this.convert(n,this.workingColorSpace,r)},colorSpaceToWorking:function(n,r){return this.convert(n,r,this.workingColorSpace)},getPrimaries:function(n){return this.spaces[n].primaries},getTransfer:function(n){return n===zd?yu:this.spaces[n].transfer},getToneMappingMode:function(n){return this.spaces[n].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(n,r=this.workingColorSpace){return n.fromArray(this.spaces[r].luminanceCoefficients)},define:function(n){Object.assign(this.spaces,n)},_getMatrix:function(n,r,a){return n.copy(this.spaces[r].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(n){return this.spaces[n].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(n=this.workingColorSpace){return this.spaces[n].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(n,r){return _r("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(n,r)},toWorkingColorSpace:function(n,r){return _r("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(n,r)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],i=[.3127,.329];return s.define({[_u]:{primaries:t,whitePoint:i,transfer:yu,toXYZ:Tu,fromXYZ:Au,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:ai},outputColorSpaceConfig:{drawingBufferColorSpace:ai}},[ai]:{primaries:t,whitePoint:i,transfer:Bo,toXYZ:Tu,fromXYZ:Au,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:ai}}}),s}const fi=Ry();function Ji(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function Bs(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}let ms;class Cy{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{ms===void 0&&(ms=Su("canvas")),ms.width=t.width,ms.height=t.height;const n=ms.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),i=ms}return i.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Su("canvas");e.width=t.width,e.height=t.height;const i=e.getContext("2d");i.drawImage(t,0,0,t.width,t.height);const n=i.getImageData(0,0,t.width,t.height),r=n.data;for(let a=0;a<r.length;a++)r[a]=Ji(r[a]/255)*255;return i.putImageData(n,0,0),e}else if(t.data){const e=t.data.slice(0);for(let i=0;i<e.length;i++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[i]=Math.floor(Ji(e[i]/255)*255):e[i]=Ji(e[i]);return{data:e,width:t.width,height:t.height}}else return be("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let Py=0;class Dy{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Py++}),this.uuid=vn(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const i={uuid:this.uuid,url:""},n=this.data;if(n!==null){let r;if(Array.isArray(n)){r=[];for(let a=0,o=n.length;a<o;a++)n[a].isDataTexture?r.push(Ho(n[a].image)):r.push(Ho(n[a]))}else r=Ho(n);i.url=r}return e||(t.images[this.uuid]=i),i}}function Ho(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?Cy.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(be("Texture: Unable to serialize Texture."),{})}let Iy=0;const Wo=new W;class Sn extends Tr{constructor(t=Sn.DEFAULT_IMAGE,e=Sn.DEFAULT_MAPPING,i=na,n=na,r=My,a=vy,o=Ey,l=Sy,h=Sn.DEFAULT_ANISOTROPY,u=zd){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Iy++}),this.uuid=vn(),this.name="",this.source=new Dy(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=i,this.wrapT=n,this.magFilter=r,this.minFilter=a,this.anisotropy=h,this.format=o,this.internalFormat=null,this.type=l,this.offset=new re(0,0),this.repeat=new re(1,1),this.center=new re(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new tn,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Wo).x}get height(){return this.source.getSize(Wo).y}get depth(){return this.source.getSize(Wo).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const i=t[e];if(i===void 0){be(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){be(`Texture.setValues(): property '${e}' does not exist.`);continue}n&&i&&n.isVector2&&i.isVector2||n&&i&&n.isVector3&&i.isVector3||n&&i&&n.isMatrix3&&i.isMatrix3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),e||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==Od)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case gu:t.x=t.x-Math.floor(t.x);break;case na:t.x=t.x<0?0:1;break;case xu:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case gu:t.y=t.y-Math.floor(t.y);break;case na:t.y=t.y<0?0:1;break;case xu:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Sn.DEFAULT_IMAGE=null;Sn.DEFAULT_MAPPING=Od;Sn.DEFAULT_ANISOTROPY=1;class qn{static{qn.prototype.isVector4=!0}constructor(t=0,e=0,i=0,n=1){this.x=t,this.y=e,this.z=i,this.w=n}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,i,n){return this.x=t,this.y=e,this.z=i,this.w=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,i=this.y,n=this.z,r=this.w,a=t.elements;return this.x=a[0]*e+a[4]*i+a[8]*n+a[12]*r,this.y=a[1]*e+a[5]*i+a[9]*n+a[13]*r,this.z=a[2]*e+a[6]*i+a[10]*n+a[14]*r,this.w=a[3]*e+a[7]*i+a[11]*n+a[15]*r,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,i,n,r;const l=t.elements,h=l[0],u=l[4],d=l[8],c=l[1],f=l[5],g=l[9],_=l[2],m=l[6],p=l[10];if(Math.abs(u-c)<.01&&Math.abs(d-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(u+c)<.1&&Math.abs(d+_)<.1&&Math.abs(g+m)<.1&&Math.abs(h+f+p-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const E=(h+1)/2,M=(f+1)/2,T=(p+1)/2,b=(u+c)/4,A=(d+_)/4,x=(g+m)/4;return E>M&&E>T?E<.01?(i=0,n=.707106781,r=.707106781):(i=Math.sqrt(E),n=b/i,r=A/i):M>T?M<.01?(i=.707106781,n=0,r=.707106781):(n=Math.sqrt(M),i=b/n,r=x/n):T<.01?(i=.707106781,n=.707106781,r=0):(r=Math.sqrt(T),i=A/r,n=x/r),this.set(i,n,r,e),this}let v=Math.sqrt((m-g)*(m-g)+(d-_)*(d-_)+(c-u)*(c-u));return Math.abs(v)<.001&&(v=1),this.x=(m-g)/v,this.y=(d-_)/v,this.z=(c-u)/v,this.w=Math.acos((h+f+p-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Vt(this.x,t.x,e.x),this.y=Vt(this.y,t.y,e.y),this.z=Vt(this.z,t.z,e.z),this.w=Vt(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Vt(this.x,t,e),this.y=Vt(this.y,t,e),this.z=Vt(this.z,t,e),this.w=Vt(this.w,t,e),this}clampLength(t,e){const i=this.length();return this.divideScalar(i||1).multiplyScalar(Vt(i,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,i){return this.x=t.x+(e.x-t.x)*i,this.y=t.y+(e.y-t.y)*i,this.z=t.z+(e.z-t.z)*i,this.w=t.w+(e.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Ye{static{Ye.prototype.isMatrix4=!0}constructor(t,e,i,n,r,a,o,l,h,u,d,c,f,g,_,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,i,n,r,a,o,l,h,u,d,c,f,g,_,m)}set(t,e,i,n,r,a,o,l,h,u,d,c,f,g,_,m){const p=this.elements;return p[0]=t,p[4]=e,p[8]=i,p[12]=n,p[1]=r,p[5]=a,p[9]=o,p[13]=l,p[2]=h,p[6]=u,p[10]=d,p[14]=c,p[3]=f,p[7]=g,p[11]=_,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Ye().fromArray(this.elements)}copy(t){const e=this.elements,i=t.elements;return e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=i[3],e[4]=i[4],e[5]=i[5],e[6]=i[6],e[7]=i[7],e[8]=i[8],e[9]=i[9],e[10]=i[10],e[11]=i[11],e[12]=i[12],e[13]=i[13],e[14]=i[14],e[15]=i[15],this}copyPosition(t){const e=this.elements,i=t.elements;return e[12]=i[12],e[13]=i[13],e[14]=i[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,i){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,e,i){return this.set(t.x,e.x,i.x,0,t.y,e.y,i.y,0,t.z,e.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,i=t.elements,n=1/gs.setFromMatrixColumn(t,0).length(),r=1/gs.setFromMatrixColumn(t,1).length(),a=1/gs.setFromMatrixColumn(t,2).length();return e[0]=i[0]*n,e[1]=i[1]*n,e[2]=i[2]*n,e[3]=0,e[4]=i[4]*r,e[5]=i[5]*r,e[6]=i[6]*r,e[7]=0,e[8]=i[8]*a,e[9]=i[9]*a,e[10]=i[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,i=t.x,n=t.y,r=t.z,a=Math.cos(i),o=Math.sin(i),l=Math.cos(n),h=Math.sin(n),u=Math.cos(r),d=Math.sin(r);if(t.order==="XYZ"){const c=a*u,f=a*d,g=o*u,_=o*d;e[0]=l*u,e[4]=-l*d,e[8]=h,e[1]=f+g*h,e[5]=c-_*h,e[9]=-o*l,e[2]=_-c*h,e[6]=g+f*h,e[10]=a*l}else if(t.order==="YXZ"){const c=l*u,f=l*d,g=h*u,_=h*d;e[0]=c+_*o,e[4]=g*o-f,e[8]=a*h,e[1]=a*d,e[5]=a*u,e[9]=-o,e[2]=f*o-g,e[6]=_+c*o,e[10]=a*l}else if(t.order==="ZXY"){const c=l*u,f=l*d,g=h*u,_=h*d;e[0]=c-_*o,e[4]=-a*d,e[8]=g+f*o,e[1]=f+g*o,e[5]=a*u,e[9]=_-c*o,e[2]=-a*h,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const c=a*u,f=a*d,g=o*u,_=o*d;e[0]=l*u,e[4]=g*h-f,e[8]=c*h+_,e[1]=l*d,e[5]=_*h+c,e[9]=f*h-g,e[2]=-h,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const c=a*l,f=a*h,g=o*l,_=o*h;e[0]=l*u,e[4]=_-c*d,e[8]=g*d+f,e[1]=d,e[5]=a*u,e[9]=-o*u,e[2]=-h*u,e[6]=f*d+g,e[10]=c-_*d}else if(t.order==="XZY"){const c=a*l,f=a*h,g=o*l,_=o*h;e[0]=l*u,e[4]=-d,e[8]=h*u,e[1]=c*d+_,e[5]=a*u,e[9]=f*d-g,e[2]=g*d-f,e[6]=o*u,e[10]=_*d+c}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Ly,t,Ny)}lookAt(t,e,i){const n=this.elements;return Je.subVectors(t,e),Je.lengthSq()===0&&(Je.z=1),Je.normalize(),un.crossVectors(i,Je),un.lengthSq()===0&&(Math.abs(i.z)===1?Je.x+=1e-4:Je.z+=1e-4,Je.normalize(),un.crossVectors(i,Je)),un.normalize(),ra.crossVectors(Je,un),n[0]=un.x,n[4]=ra.x,n[8]=Je.x,n[1]=un.y,n[5]=ra.y,n[9]=Je.y,n[2]=un.z,n[6]=ra.z,n[10]=Je.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const i=t.elements,n=e.elements,r=this.elements,a=i[0],o=i[4],l=i[8],h=i[12],u=i[1],d=i[5],c=i[9],f=i[13],g=i[2],_=i[6],m=i[10],p=i[14],v=i[3],E=i[7],M=i[11],T=i[15],b=n[0],A=n[4],x=n[8],w=n[12],C=n[1],P=n[5],D=n[9],z=n[13],X=n[2],N=n[6],Y=n[10],V=n[14],Q=n[3],tt=n[7],nt=n[11],ct=n[15];return r[0]=a*b+o*C+l*X+h*Q,r[4]=a*A+o*P+l*N+h*tt,r[8]=a*x+o*D+l*Y+h*nt,r[12]=a*w+o*z+l*V+h*ct,r[1]=u*b+d*C+c*X+f*Q,r[5]=u*A+d*P+c*N+f*tt,r[9]=u*x+d*D+c*Y+f*nt,r[13]=u*w+d*z+c*V+f*ct,r[2]=g*b+_*C+m*X+p*Q,r[6]=g*A+_*P+m*N+p*tt,r[10]=g*x+_*D+m*Y+p*nt,r[14]=g*w+_*z+m*V+p*ct,r[3]=v*b+E*C+M*X+T*Q,r[7]=v*A+E*P+M*N+T*tt,r[11]=v*x+E*D+M*Y+T*nt,r[15]=v*w+E*z+M*V+T*ct,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],i=t[4],n=t[8],r=t[12],a=t[1],o=t[5],l=t[9],h=t[13],u=t[2],d=t[6],c=t[10],f=t[14],g=t[3],_=t[7],m=t[11],p=t[15],v=l*f-h*c,E=o*f-h*d,M=o*c-l*d,T=a*f-h*u,b=a*c-l*u,A=a*d-o*u;return e*(_*v-m*E+p*M)-i*(g*v-m*T+p*b)+n*(g*E-_*T+p*A)-r*(g*M-_*b+m*A)}determinantAffine(){const t=this.elements,e=t[0],i=t[4],n=t[8],r=t[1],a=t[5],o=t[9],l=t[2],h=t[6],u=t[10];return e*(a*u-o*h)-i*(r*u-o*l)+n*(r*h-a*l)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,i){const n=this.elements;return t.isVector3?(n[12]=t.x,n[13]=t.y,n[14]=t.z):(n[12]=t,n[13]=e,n[14]=i),this}invert(){const t=this.elements,e=t[0],i=t[1],n=t[2],r=t[3],a=t[4],o=t[5],l=t[6],h=t[7],u=t[8],d=t[9],c=t[10],f=t[11],g=t[12],_=t[13],m=t[14],p=t[15],v=e*o-i*a,E=e*l-n*a,M=e*h-r*a,T=i*l-n*o,b=i*h-r*o,A=n*h-r*l,x=u*_-d*g,w=u*m-c*g,C=u*p-f*g,P=d*m-c*_,D=d*p-f*_,z=c*p-f*m,X=v*z-E*D+M*P+T*C-b*w+A*x;if(X===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const N=1/X;return t[0]=(o*z-l*D+h*P)*N,t[1]=(n*D-i*z-r*P)*N,t[2]=(_*A-m*b+p*T)*N,t[3]=(c*b-d*A-f*T)*N,t[4]=(l*C-a*z-h*w)*N,t[5]=(e*z-n*C+r*w)*N,t[6]=(m*M-g*A-p*E)*N,t[7]=(u*A-c*M+f*E)*N,t[8]=(a*D-o*C+h*x)*N,t[9]=(i*C-e*D-r*x)*N,t[10]=(g*b-_*M+p*v)*N,t[11]=(d*M-u*b-f*v)*N,t[12]=(o*w-a*P-l*x)*N,t[13]=(e*P-i*w+n*x)*N,t[14]=(_*E-g*T-m*v)*N,t[15]=(u*T-d*E+c*v)*N,this}scale(t){const e=this.elements,i=t.x,n=t.y,r=t.z;return e[0]*=i,e[4]*=n,e[8]*=r,e[1]*=i,e[5]*=n,e[9]*=r,e[2]*=i,e[6]*=n,e[10]*=r,e[3]*=i,e[7]*=n,e[11]*=r,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],n=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,i,n))}makeTranslation(t,e,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,i,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,e,-i,0,0,i,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,0,i,0,0,1,0,0,-i,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),i=Math.sin(t);return this.set(e,-i,0,0,i,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const i=Math.cos(e),n=Math.sin(e),r=1-i,a=t.x,o=t.y,l=t.z,h=r*a,u=r*o;return this.set(h*a+i,h*o-n*l,h*l+n*o,0,h*o+n*l,u*o+i,u*l-n*a,0,h*l-n*o,u*l+n*a,r*l*l+i,0,0,0,0,1),this}makeScale(t,e,i){return this.set(t,0,0,0,0,e,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,e,i,n,r,a){return this.set(1,i,r,0,t,1,a,0,e,n,1,0,0,0,0,1),this}compose(t,e,i){const n=this.elements,r=e._x,a=e._y,o=e._z,l=e._w,h=r+r,u=a+a,d=o+o,c=r*h,f=r*u,g=r*d,_=a*u,m=a*d,p=o*d,v=l*h,E=l*u,M=l*d,T=i.x,b=i.y,A=i.z;return n[0]=(1-(_+p))*T,n[1]=(f+M)*T,n[2]=(g-E)*T,n[3]=0,n[4]=(f-M)*b,n[5]=(1-(c+p))*b,n[6]=(m+v)*b,n[7]=0,n[8]=(g+E)*A,n[9]=(m-v)*A,n[10]=(1-(c+_))*A,n[11]=0,n[12]=t.x,n[13]=t.y,n[14]=t.z,n[15]=1,this}decompose(t,e,i){const n=this.elements;t.x=n[12],t.y=n[13],t.z=n[14];const r=this.determinantAffine();if(r===0)return i.set(1,1,1),e.identity(),this;let a=gs.set(n[0],n[1],n[2]).length();const o=gs.set(n[4],n[5],n[6]).length(),l=gs.set(n[8],n[9],n[10]).length();r<0&&(a=-a),pi.copy(this);const h=1/a,u=1/o,d=1/l;return pi.elements[0]*=h,pi.elements[1]*=h,pi.elements[2]*=h,pi.elements[4]*=u,pi.elements[5]*=u,pi.elements[6]*=u,pi.elements[8]*=d,pi.elements[9]*=d,pi.elements[10]*=d,e.setFromRotationMatrix(pi),i.x=a,i.y=o,i.z=l,this}makePerspective(t,e,i,n,r,a,o=sa,l=!1){const h=this.elements,u=2*r/(e-t),d=2*r/(i-n),c=(e+t)/(e-t),f=(i+n)/(i-n);let g,_;if(l)g=r/(a-r),_=a*r/(a-r);else if(o===sa)g=-(a+r)/(a-r),_=-2*a*r/(a-r);else if(o===vu)g=-a/(a-r),_=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return h[0]=u,h[4]=0,h[8]=c,h[12]=0,h[1]=0,h[5]=d,h[9]=f,h[13]=0,h[2]=0,h[6]=0,h[10]=g,h[14]=_,h[3]=0,h[7]=0,h[11]=-1,h[15]=0,this}makeOrthographic(t,e,i,n,r,a,o=sa,l=!1){const h=this.elements,u=2/(e-t),d=2/(i-n),c=-(e+t)/(e-t),f=-(i+n)/(i-n);let g,_;if(l)g=1/(a-r),_=a/(a-r);else if(o===sa)g=-2/(a-r),_=-(a+r)/(a-r);else if(o===vu)g=-1/(a-r),_=-r/(a-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return h[0]=u,h[4]=0,h[8]=0,h[12]=c,h[1]=0,h[5]=d,h[9]=0,h[13]=f,h[2]=0,h[6]=0,h[10]=g,h[14]=_,h[3]=0,h[7]=0,h[11]=0,h[15]=1,this}equals(t){const e=this.elements,i=t.elements;for(let n=0;n<16;n++)if(e[n]!==i[n])return!1;return!0}fromArray(t,e=0){for(let i=0;i<16;i++)this.elements[i]=t[i+e];return this}toArray(t=[],e=0){const i=this.elements;return t[e]=i[0],t[e+1]=i[1],t[e+2]=i[2],t[e+3]=i[3],t[e+4]=i[4],t[e+5]=i[5],t[e+6]=i[6],t[e+7]=i[7],t[e+8]=i[8],t[e+9]=i[9],t[e+10]=i[10],t[e+11]=i[11],t[e+12]=i[12],t[e+13]=i[13],t[e+14]=i[14],t[e+15]=i[15],t}}const gs=new W,pi=new Ye,Ly=new W(0,0,0),Ny=new W(1,1,1),un=new W,ra=new W,Je=new W,Ru=new Ye,Cu=new Ar;class Rr{constructor(t=0,e=0,i=0,n=Rr.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=i,this._order=n}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,i,n=this._order){return this._x=t,this._y=e,this._z=i,this._order=n,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,i=!0){const n=t.elements,r=n[0],a=n[4],o=n[8],l=n[1],h=n[5],u=n[9],d=n[2],c=n[6],f=n[10];switch(e){case"XYZ":this._y=Math.asin(Vt(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-u,f),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(c,h),this._z=0);break;case"YXZ":this._x=Math.asin(-Vt(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,h)):(this._y=Math.atan2(-d,r),this._z=0);break;case"ZXY":this._x=Math.asin(Vt(c,-1,1)),Math.abs(c)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-a,h)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Vt(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(c,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,h));break;case"YZX":this._z=Math.asin(Vt(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,h),this._y=Math.atan2(-d,r)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Vt(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(c,h),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-u,f),this._y=0);break;default:be("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,i){return Ru.makeRotationFromQuaternion(t),this.setFromRotationMatrix(Ru,e,i)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return Cu.setFromEuler(this),this.setFromQuaternion(Cu,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Rr.DEFAULT_ORDER="XYZ";class Fy{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let Uy=0;const Pu=new W,xs=new Ar,Gi=new Ye,aa=new W,sr=new W,Oy=new W,zy=new Ar,Du=new W(1,0,0),Iu=new W(0,1,0),Lu=new W(0,0,1),Nu={type:"added"},By={type:"removed"},_s={type:"childadded",child:null},Xo={type:"childremoved",child:null};class li extends Tr{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Uy++}),this.uuid=vn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=li.DEFAULT_UP.clone();const t=new W,e=new Rr,i=new Ar,n=new W(1,1,1);function r(){i.setFromEuler(e,!1)}function a(){e.setFromQuaternion(i,void 0,!1)}e._onChange(r),i._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:n},modelViewMatrix:{value:new Ye},normalMatrix:{value:new tn}}),this.matrix=new Ye,this.matrixWorld=new Ye,this.matrixAutoUpdate=li.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=li.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Fy,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return xs.setFromAxisAngle(t,e),this.quaternion.multiply(xs),this}rotateOnWorldAxis(t,e){return xs.setFromAxisAngle(t,e),this.quaternion.premultiply(xs),this}rotateX(t){return this.rotateOnAxis(Du,t)}rotateY(t){return this.rotateOnAxis(Iu,t)}rotateZ(t){return this.rotateOnAxis(Lu,t)}translateOnAxis(t,e){return Pu.copy(t).applyQuaternion(this.quaternion),this.position.add(Pu.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(Du,t)}translateY(t){return this.translateOnAxis(Iu,t)}translateZ(t){return this.translateOnAxis(Lu,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Gi.copy(this.matrixWorld).invert())}lookAt(t,e,i){t.isVector3?aa.copy(t):aa.set(t,e,i);const n=this.parent;this.updateWorldMatrix(!0,!1),sr.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Gi.lookAt(sr,aa,this.up):Gi.lookAt(aa,sr,this.up),this.quaternion.setFromRotationMatrix(Gi),n&&(Gi.extractRotation(n.matrixWorld),xs.setFromRotationMatrix(Gi),this.quaternion.premultiply(xs.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(yn("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Nu),_s.child=t,this.dispatchEvent(_s),_s.child=null):yn("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(By),Xo.child=t,this.dispatchEvent(Xo),Xo.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Gi.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Gi.multiply(t.parent.matrixWorld)),t.applyMatrix4(Gi),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Nu),_s.child=t,this.dispatchEvent(_s),_s.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let i=0,n=this.children.length;i<n;i++){const a=this.children[i].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,i=[]){this[t]===e&&i.push(this);const n=this.children;for(let r=0,a=n.length;r<a;r++)n[r].getObjectsByProperty(t,e,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(sr,t,Oy),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(sr,zy,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,i=t.y,n=t.z,r=this.matrix.elements;r[12]+=e-r[0]*e-r[4]*i-r[8]*n,r[13]+=i-r[1]*e-r[5]*i-r[9]*n,r[14]+=n-r[2]*e-r[6]*i-r[10]*n}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let i=0,n=e.length;i<n;i++)e[i].updateMatrixWorld(t)}updateWorldMatrix(t,e,i=!1){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),e===!0){const r=this.children;for(let a=0,o=r.length;a<o;a++)r[a].updateWorldMatrix(!1,!0,i)}}toJSON(t){const e=t===void 0||typeof t=="string",i={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const n={};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.castShadow===!0&&(n.castShadow=!0),this.receiveShadow===!0&&(n.receiveShadow=!0),this.visible===!1&&(n.visible=!1),this.frustumCulled===!1&&(n.frustumCulled=!1),this.renderOrder!==0&&(n.renderOrder=this.renderOrder),this.static!==!1&&(n.static=this.static),Object.keys(this.userData).length>0&&(n.userData=this.userData),n.layers=this.layers.mask,n.matrix=this.matrix.toArray(),n.up=this.up.toArray(),this.pivot!==null&&(n.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(n.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(n.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(n.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(n.type="InstancedMesh",n.count=this.count,n.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(n.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(n.type="BatchedMesh",n.perObjectFrustumCulled=this.perObjectFrustumCulled,n.sortObjects=this.sortObjects,n.drawRanges=this._drawRanges,n.reservedRanges=this._reservedRanges,n.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),n.instanceInfo=this._instanceInfo.map(o=>({...o})),n.availableInstanceIds=this._availableInstanceIds.slice(),n.availableGeometryIds=this._availableGeometryIds.slice(),n.nextIndexStart=this._nextIndexStart,n.nextVertexStart=this._nextVertexStart,n.geometryCount=this._geometryCount,n.maxInstanceCount=this._maxInstanceCount,n.maxVertexCount=this._maxVertexCount,n.maxIndexCount=this._maxIndexCount,n.geometryInitialized=this._geometryInitialized,n.matricesTexture=this._matricesTexture.toJSON(t),n.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(n.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(n.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(n.boundingBox=this.boundingBox.toJSON()));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?n.background=this.background.toJSON():this.background.isTexture&&(n.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(n.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){n.geometry=r(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let h=0,u=l.length;h<u;h++){const d=l[h];r(t.shapes,d)}else r(t.shapes,l)}}if(this.isSkinnedMesh&&(n.bindMode=this.bindMode,n.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),n.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,h=this.material.length;l<h;l++)o.push(r(t.materials,this.material[l]));n.material=o}else n.material=r(t.materials,this.material);if(this.children.length>0){n.children=[];for(let o=0;o<this.children.length;o++)n.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){n.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];n.animations.push(r(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),h=a(t.textures),u=a(t.images),d=a(t.shapes),c=a(t.skeletons),f=a(t.animations),g=a(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),h.length>0&&(i.textures=h),u.length>0&&(i.images=u),d.length>0&&(i.shapes=d),c.length>0&&(i.skeletons=c),f.length>0&&(i.animations=f),g.length>0&&(i.nodes=g)}return i.object=n,i;function a(o){const l=[];for(const h in o){const u=o[h];delete u.metadata,l.push(u)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let i=0;i<t.children.length;i++){const n=t.children[i];this.add(n.clone())}return this}}li.DEFAULT_UP=new W(0,1,0);li.DEFAULT_MATRIX_AUTO_UPDATE=!0;li.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;class dn extends li{constructor(){super(),this.isGroup=!0,this.type="Group"}}const kd={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},fn={h:0,s:0,l:0},oa={h:0,s:0,l:0};function qo(s,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?s+(t-s)*6*e:e<1/2?t:e<2/3?s+(t-s)*6*(2/3-e):s}class Ui{constructor(t,e,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,i)}set(t,e,i){if(e===void 0&&i===void 0){const n=t;n&&n.isColor?this.copy(n):typeof n=="number"?this.setHex(n):typeof n=="string"&&this.setStyle(n)}else this.setRGB(t,e,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=ai){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,fi.colorSpaceToWorking(this,e),this}setRGB(t,e,i,n=fi.workingColorSpace){return this.r=t,this.g=e,this.b=i,fi.colorSpaceToWorking(this,n),this}setHSL(t,e,i,n=fi.workingColorSpace){if(t=Ay(t,1),e=Vt(e,0,1),i=Vt(i,0,1),e===0)this.r=this.g=this.b=i;else{const r=i<=.5?i*(1+e):i+e-i*e,a=2*i-r;this.r=qo(a,r,t+1/3),this.g=qo(a,r,t),this.b=qo(a,r,t-1/3)}return fi.colorSpaceToWorking(this,n),this}setStyle(t,e=ai){function i(r){r!==void 0&&parseFloat(r)<1&&be("Color: Alpha component of "+t+" will be ignored.")}let n;if(n=/^(\w+)\(([^\)]*)\)/.exec(t)){let r;const a=n[1],o=n[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:be("Color: Unknown color model "+t)}}else if(n=/^\#([A-Fa-f\d]+)$/.exec(t)){const r=n[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(r,16),e);be("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=ai){const i=kd[t.toLowerCase()];return i!==void 0?this.setHex(i,e):be("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=Ji(t.r),this.g=Ji(t.g),this.b=Ji(t.b),this}copyLinearToSRGB(t){return this.r=Bs(t.r),this.g=Bs(t.g),this.b=Bs(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=ai){return fi.workingToColorSpace(ze.copy(this),t),Math.round(Vt(ze.r*255,0,255))*65536+Math.round(Vt(ze.g*255,0,255))*256+Math.round(Vt(ze.b*255,0,255))}getHexString(t=ai){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=fi.workingColorSpace){fi.workingToColorSpace(ze.copy(this),e);const i=ze.r,n=ze.g,r=ze.b,a=Math.max(i,n,r),o=Math.min(i,n,r);let l,h;const u=(o+a)/2;if(o===a)l=0,h=0;else{const d=a-o;switch(h=u<=.5?d/(a+o):d/(2-a-o),a){case i:l=(n-r)/d+(n<r?6:0);break;case n:l=(r-i)/d+2;break;case r:l=(i-n)/d+4;break}l/=6}return t.h=l,t.s=h,t.l=u,t}getRGB(t,e=fi.workingColorSpace){return fi.workingToColorSpace(ze.copy(this),e),t.r=ze.r,t.g=ze.g,t.b=ze.b,t}getStyle(t=ai){fi.workingToColorSpace(ze.copy(this),t);const e=ze.r,i=ze.g,n=ze.b;return t!==ai?`color(${t} ${e.toFixed(3)} ${i.toFixed(3)} ${n.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(i*255)},${Math.round(n*255)})`}offsetHSL(t,e,i){return this.getHSL(fn),this.setHSL(fn.h+t,fn.s+e,fn.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,i){return this.r=t.r+(e.r-t.r)*i,this.g=t.g+(e.g-t.g)*i,this.b=t.b+(e.b-t.b)*i,this}lerpHSL(t,e){this.getHSL(fn),t.getHSL(oa);const i=ko(fn.h,oa.h,e),n=ko(fn.s,oa.s,e),r=ko(fn.l,oa.l,e);return this.setHSL(i,n,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,i=this.g,n=this.b,r=t.elements;return this.r=r[0]*e+r[3]*i+r[6]*n,this.g=r[1]*e+r[4]*i+r[7]*n,this.b=r[2]*e+r[5]*i+r[8]*n,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const ze=new Ui;Ui.NAMES=kd;const mi=new W,Hi=new W,Yo=new W,Wi=new W,ys=new W,Ms=new W,Fu=new W,$o=new W,Zo=new W,Ko=new W,Jo=new qn,Qo=new qn,jo=new qn;class ii{constructor(t=new W,e=new W,i=new W){this.a=t,this.b=e,this.c=i}static getNormal(t,e,i,n){n.subVectors(i,e),mi.subVectors(t,e),n.cross(mi);const r=n.lengthSq();return r>0?n.multiplyScalar(1/Math.sqrt(r)):n.set(0,0,0)}static getBarycoord(t,e,i,n,r){mi.subVectors(n,e),Hi.subVectors(i,e),Yo.subVectors(t,e);const a=mi.dot(mi),o=mi.dot(Hi),l=mi.dot(Yo),h=Hi.dot(Hi),u=Hi.dot(Yo),d=a*h-o*o;if(d===0)return r.set(0,0,0),null;const c=1/d,f=(h*l-o*u)*c,g=(a*u-o*l)*c;return r.set(1-f-g,g,f)}static containsPoint(t,e,i,n){return this.getBarycoord(t,e,i,n,Wi)===null?!1:Wi.x>=0&&Wi.y>=0&&Wi.x+Wi.y<=1}static getInterpolation(t,e,i,n,r,a,o,l){return this.getBarycoord(t,e,i,n,Wi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,Wi.x),l.addScaledVector(a,Wi.y),l.addScaledVector(o,Wi.z),l)}static getInterpolatedAttribute(t,e,i,n,r,a){return Jo.setScalar(0),Qo.setScalar(0),jo.setScalar(0),Jo.fromBufferAttribute(t,e),Qo.fromBufferAttribute(t,i),jo.fromBufferAttribute(t,n),a.setScalar(0),a.addScaledVector(Jo,r.x),a.addScaledVector(Qo,r.y),a.addScaledVector(jo,r.z),a}static isFrontFacing(t,e,i,n){return mi.subVectors(i,e),Hi.subVectors(t,e),mi.cross(Hi).dot(n)<0}set(t,e,i){return this.a.copy(t),this.b.copy(e),this.c.copy(i),this}setFromPointsAndIndices(t,e,i,n){return this.a.copy(t[e]),this.b.copy(t[i]),this.c.copy(t[n]),this}setFromAttributeAndIndices(t,e,i,n){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return mi.subVectors(this.c,this.b),Hi.subVectors(this.a,this.b),mi.cross(Hi).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return ii.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return ii.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,i,n,r){return ii.getInterpolation(t,this.a,this.b,this.c,e,i,n,r)}containsPoint(t){return ii.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return ii.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const i=this.a,n=this.b,r=this.c;let a,o;ys.subVectors(n,i),Ms.subVectors(r,i),$o.subVectors(t,i);const l=ys.dot($o),h=Ms.dot($o);if(l<=0&&h<=0)return e.copy(i);Zo.subVectors(t,n);const u=ys.dot(Zo),d=Ms.dot(Zo);if(u>=0&&d<=u)return e.copy(n);const c=l*d-u*h;if(c<=0&&l>=0&&u<=0)return a=l/(l-u),e.copy(i).addScaledVector(ys,a);Ko.subVectors(t,r);const f=ys.dot(Ko),g=Ms.dot(Ko);if(g>=0&&f<=g)return e.copy(r);const _=f*h-l*g;if(_<=0&&h>=0&&g<=0)return o=h/(h-g),e.copy(i).addScaledVector(Ms,o);const m=u*g-f*d;if(m<=0&&d-u>=0&&f-g>=0)return Fu.subVectors(r,n),o=(d-u)/(d-u+(f-g)),e.copy(n).addScaledVector(Fu,o);const p=1/(m+_+c);return a=_*p,o=c*p,e.copy(i).addScaledVector(ys,a).addScaledVector(Ms,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}class Cr{constructor(t=new W(1/0,1/0,1/0),e=new W(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e+=3)this.expandByPoint(gi.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,i=t.count;e<i;e++)this.expandByPoint(gi.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,i=t.length;e<i;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const i=gi.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const i=t.geometry;if(i!==void 0){const r=i.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,gi):gi.fromBufferAttribute(r,a),gi.applyMatrix4(t.matrixWorld),this.expandByPoint(gi);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),la.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),la.copy(i.boundingBox)),la.applyMatrix4(t.matrixWorld),this.union(la)}const n=t.children;for(let r=0,a=n.length;r<a;r++)this.expandByObject(n[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,gi),gi.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,i;return t.normal.x>0?(e=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),e<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(rr),ha.subVectors(this.max,rr),vs.subVectors(t.a,rr),Ss.subVectors(t.b,rr),bs.subVectors(t.c,rr),pn.subVectors(Ss,vs),mn.subVectors(bs,Ss),Nn.subVectors(vs,bs);let e=[0,-pn.z,pn.y,0,-mn.z,mn.y,0,-Nn.z,Nn.y,pn.z,0,-pn.x,mn.z,0,-mn.x,Nn.z,0,-Nn.x,-pn.y,pn.x,0,-mn.y,mn.x,0,-Nn.y,Nn.x,0];return!tl(e,vs,Ss,bs,ha)||(e=[1,0,0,0,1,0,0,0,1],!tl(e,vs,Ss,bs,ha))?!1:(ca.crossVectors(pn,mn),e=[ca.x,ca.y,ca.z],tl(e,vs,Ss,bs,ha))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,gi).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(gi).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(Xi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),Xi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),Xi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),Xi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),Xi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),Xi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),Xi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),Xi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(Xi),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}}const Xi=[new W,new W,new W,new W,new W,new W,new W,new W],gi=new W,la=new Cr,vs=new W,Ss=new W,bs=new W,pn=new W,mn=new W,Nn=new W,rr=new W,ha=new W,ca=new W,Fn=new W;function tl(s,t,e,i,n){for(let r=0,a=s.length-3;r<=a;r+=3){Fn.fromArray(s,r);const o=n.x*Math.abs(Fn.x)+n.y*Math.abs(Fn.y)+n.z*Math.abs(Fn.z),l=t.dot(Fn),h=e.dot(Fn),u=i.dot(Fn);if(Math.max(-Math.max(l,h,u),Math.min(l,h,u))>o)return!1}return!0}const ye=new W,ua=new re;let ky=0;class Ni extends Tr{constructor(t,e,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:ky++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=i,this.usage=rh,this.updateRanges=[],this.gpuType=by,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,i){t*=this.itemSize,i*=e.itemSize;for(let n=0,r=this.itemSize;n<r;n++)this.array[t+n]=e.array[i+n];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,i=this.count;e<i;e++)ua.fromBufferAttribute(this,e),ua.applyMatrix3(t),this.setXY(e,ua.x,ua.y);else if(this.itemSize===3)for(let e=0,i=this.count;e<i;e++)ye.fromBufferAttribute(this,e),ye.applyMatrix3(t),this.setXYZ(e,ye.x,ye.y,ye.z);return this}applyMatrix4(t){for(let e=0,i=this.count;e<i;e++)ye.fromBufferAttribute(this,e),ye.applyMatrix4(t),this.setXYZ(e,ye.x,ye.y,ye.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)ye.fromBufferAttribute(this,e),ye.applyNormalMatrix(t),this.setXYZ(e,ye.x,ye.y,ye.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)ye.fromBufferAttribute(this,e),ye.transformDirection(t),this.setXYZ(e,ye.x,ye.y,ye.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let i=this.array[t*this.itemSize+e];return this.normalized&&(i=Pi(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=Qt(i,this.array)),this.array[t*this.itemSize+e]=i,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Pi(e,this.array)),e}setX(t,e){return this.normalized&&(e=Qt(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Pi(e,this.array)),e}setY(t,e){return this.normalized&&(e=Qt(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Pi(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Qt(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Pi(e,this.array)),e}setW(t,e){return this.normalized&&(e=Qt(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,i){return t*=this.itemSize,this.normalized&&(e=Qt(e,this.array),i=Qt(i,this.array)),this.array[t+0]=e,this.array[t+1]=i,this}setXYZ(t,e,i,n){return t*=this.itemSize,this.normalized&&(e=Qt(e,this.array),i=Qt(i,this.array),n=Qt(n,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this}setXYZW(t,e,i,n,r){return t*=this.itemSize,this.normalized&&(e=Qt(e,this.array),i=Qt(i,this.array),n=Qt(n,this.array),r=Qt(r,this.array)),this.array[t+0]=e,this.array[t+1]=i,this.array[t+2]=n,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==rh&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}}class Vy extends Ni{constructor(t,e,i){super(new Uint16Array(t),e,i)}}class Gy extends Ni{constructor(t,e,i){super(new Uint32Array(t),e,i)}}class ae extends Ni{constructor(t,e,i){super(new Float32Array(t),e,i)}}const Hy=new Cr,ar=new W,el=new W;class Lh{constructor(t=new W,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const i=this.center;e!==void 0?i.copy(e):Hy.setFromPoints(t).getCenter(i);let n=0;for(let r=0,a=t.length;r<a;r++)n=Math.max(n,i.distanceToSquared(t[r]));return this.radius=Math.sqrt(n),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const i=this.center.distanceToSquared(t);return e.copy(t),i>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;ar.subVectors(t,this.center);const e=ar.lengthSq();if(e>this.radius*this.radius){const i=Math.sqrt(e),n=(i-this.radius)*.5;this.center.addScaledVector(ar,n/i),this.radius+=n}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(el.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(ar.copy(t.center).add(el)),this.expandByPoint(ar.copy(t.center).sub(el))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}}let Wy=0;const ri=new Ye,il=new li,Es=new W,Qe=new Cr,or=new Cr,Ce=new W;class ke extends Tr{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Wy++}),this.uuid=vn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(wy(t)?Gy:Vy)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,i=0){this.groups.push({start:t,count:e,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const i=this.attributes.normal;if(i!==void 0){const r=new tn().getNormalMatrix(t);i.applyNormalMatrix(r),i.needsUpdate=!0}const n=this.attributes.tangent;return n!==void 0&&(n.transformDirection(t),n.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return ri.makeRotationFromQuaternion(t),this.applyMatrix4(ri),this}rotateX(t){return ri.makeRotationX(t),this.applyMatrix4(ri),this}rotateY(t){return ri.makeRotationY(t),this.applyMatrix4(ri),this}rotateZ(t){return ri.makeRotationZ(t),this.applyMatrix4(ri),this}translate(t,e,i){return ri.makeTranslation(t,e,i),this.applyMatrix4(ri),this}scale(t,e,i){return ri.makeScale(t,e,i),this.applyMatrix4(ri),this}lookAt(t){return il.lookAt(t),il.updateMatrix(),this.applyMatrix4(il.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Es).negate(),this.translate(Es.x,Es.y,Es.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const i=[];for(let n=0,r=t.length;n<r;n++){const a=t[n];i.push(a.x,a.y,a.z||0)}this.setAttribute("position",new ae(i,3))}else{const i=Math.min(t.length,e.count);for(let n=0;n<i;n++){const r=t[n];e.setXYZ(n,r.x,r.y,r.z||0)}t.length>e.count&&be("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Cr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){yn("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new W(-1/0,-1/0,-1/0),new W(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let i=0,n=e.length;i<n;i++){const r=e[i];Qe.setFromBufferAttribute(r),this.morphTargetsRelative?(Ce.addVectors(this.boundingBox.min,Qe.min),this.boundingBox.expandByPoint(Ce),Ce.addVectors(this.boundingBox.max,Qe.max),this.boundingBox.expandByPoint(Ce)):(this.boundingBox.expandByPoint(Qe.min),this.boundingBox.expandByPoint(Qe.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&yn('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Lh);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){yn("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new W,1/0);return}if(t){const i=this.boundingSphere.center;if(Qe.setFromBufferAttribute(t),e)for(let r=0,a=e.length;r<a;r++){const o=e[r];or.setFromBufferAttribute(o),this.morphTargetsRelative?(Ce.addVectors(Qe.min,or.min),Qe.expandByPoint(Ce),Ce.addVectors(Qe.max,or.max),Qe.expandByPoint(Ce)):(Qe.expandByPoint(or.min),Qe.expandByPoint(or.max))}Qe.getCenter(i);let n=0;for(let r=0,a=t.count;r<a;r++)Ce.fromBufferAttribute(t,r),n=Math.max(n,i.distanceToSquared(Ce));if(e)for(let r=0,a=e.length;r<a;r++){const o=e[r],l=this.morphTargetsRelative;for(let h=0,u=o.count;h<u;h++)Ce.fromBufferAttribute(o,h),l&&(Es.fromBufferAttribute(t,h),Ce.add(Es)),n=Math.max(n,i.distanceToSquared(Ce))}this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&yn('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){yn("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const i=e.position,n=e.normal,r=e.uv;let a=this.getAttribute("tangent");(a===void 0||a.count!==i.count)&&(a=new Ni(new Float32Array(4*i.count),4),this.setAttribute("tangent",a));const o=[],l=[];for(let x=0;x<i.count;x++)o[x]=new W,l[x]=new W;const h=new W,u=new W,d=new W,c=new re,f=new re,g=new re,_=new W,m=new W;function p(x,w,C){h.fromBufferAttribute(i,x),u.fromBufferAttribute(i,w),d.fromBufferAttribute(i,C),c.fromBufferAttribute(r,x),f.fromBufferAttribute(r,w),g.fromBufferAttribute(r,C),u.sub(h),d.sub(h),f.sub(c),g.sub(c);const P=1/(f.x*g.y-g.x*f.y);isFinite(P)&&(_.copy(u).multiplyScalar(g.y).addScaledVector(d,-f.y).multiplyScalar(P),m.copy(d).multiplyScalar(f.x).addScaledVector(u,-g.x).multiplyScalar(P),o[x].add(_),o[w].add(_),o[C].add(_),l[x].add(m),l[w].add(m),l[C].add(m))}let v=this.groups;v.length===0&&(v=[{start:0,count:t.count}]);for(let x=0,w=v.length;x<w;++x){const C=v[x],P=C.start,D=C.count;for(let z=P,X=P+D;z<X;z+=3)p(t.getX(z+0),t.getX(z+1),t.getX(z+2))}const E=new W,M=new W,T=new W,b=new W;function A(x){T.fromBufferAttribute(n,x),b.copy(T);const w=o[x];E.copy(w),E.sub(T.multiplyScalar(T.dot(w))).normalize(),M.crossVectors(b,w);const P=M.dot(l[x])<0?-1:1;a.setXYZW(x,E.x,E.y,E.z,P)}for(let x=0,w=v.length;x<w;++x){const C=v[x],P=C.start,D=C.count;for(let z=P,X=P+D;z<X;z+=3)A(t.getX(z+0)),A(t.getX(z+1)),A(t.getX(z+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==e.count)i=new Ni(new Float32Array(e.count*3),3),this.setAttribute("normal",i);else for(let c=0,f=i.count;c<f;c++)i.setXYZ(c,0,0,0);const n=new W,r=new W,a=new W,o=new W,l=new W,h=new W,u=new W,d=new W;if(t)for(let c=0,f=t.count;c<f;c+=3){const g=t.getX(c+0),_=t.getX(c+1),m=t.getX(c+2);n.fromBufferAttribute(e,g),r.fromBufferAttribute(e,_),a.fromBufferAttribute(e,m),u.subVectors(a,r),d.subVectors(n,r),u.cross(d),o.fromBufferAttribute(i,g),l.fromBufferAttribute(i,_),h.fromBufferAttribute(i,m),o.add(u),l.add(u),h.add(u),i.setXYZ(g,o.x,o.y,o.z),i.setXYZ(_,l.x,l.y,l.z),i.setXYZ(m,h.x,h.y,h.z)}else for(let c=0,f=e.count;c<f;c+=3)n.fromBufferAttribute(e,c+0),r.fromBufferAttribute(e,c+1),a.fromBufferAttribute(e,c+2),u.subVectors(a,r),d.subVectors(n,r),u.cross(d),i.setXYZ(c+0,u.x,u.y,u.z),i.setXYZ(c+1,u.x,u.y,u.z),i.setXYZ(c+2,u.x,u.y,u.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,i=t.count;e<i;e++)Ce.fromBufferAttribute(t,e),Ce.normalize(),t.setXYZ(e,Ce.x,Ce.y,Ce.z)}toNonIndexed(){function t(o,l){const h=o.array,u=o.itemSize,d=o.normalized,c=new h.constructor(l.length*u);let f=0,g=0;for(let _=0,m=l.length;_<m;_++){o.isInterleavedBufferAttribute?f=l[_]*o.data.stride+o.offset:f=l[_]*u;for(let p=0;p<u;p++)c[g++]=h[f++]}return new Ni(c,u,d)}if(this.index===null)return be("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new ke,i=this.index.array,n=this.attributes;for(const o in n){const l=n[o],h=t(l,i);e.setAttribute(o,h)}const r=this.morphAttributes;for(const o in r){const l=[],h=r[o];for(let u=0,d=h.length;u<d;u++){const c=h[u],f=t(c,i);l.push(f)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const h=a[o];e.addGroup(h.start,h.count,h.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const l=this.parameters;for(const h in l)l[h]!==void 0&&(t[h]=l[h]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const i=this.attributes;for(const l in i){const h=i[l];t.data.attributes[l]=h.toJSON(t.data)}const n={};let r=!1;for(const l in this.morphAttributes){const h=this.morphAttributes[l],u=[];for(let d=0,c=h.length;d<c;d++){const f=h[d];u.push(f.toJSON(t.data))}u.length>0&&(n[l]=u,r=!0)}r&&(t.data.morphAttributes=n,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const i=t.index;i!==null&&this.setIndex(i.clone());const n=t.attributes;for(const h in n){const u=n[h];this.setAttribute(h,u.clone(e))}const r=t.morphAttributes;for(const h in r){const u=[],d=r[h];for(let c=0,f=d.length;c<f;c++)u.push(d[c].clone(e));this.morphAttributes[h]=u}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let h=0,u=a.length;h<u;h++){const d=a[h];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Xy{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=rh,this.updateRanges=[],this.version=0,this.uuid=vn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,i){t*=this.stride,i*=e.stride;for(let n=0,r=this.stride;n<r;n++)this.array[t+n]=e.array[i+n];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=vn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),i=new this.constructor(e,this.stride);return i.setUsage(this.usage),i}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=vn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Ve=new W;class $a{constructor(t,e,i,n=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=i,this.normalized=n}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,i=this.data.count;e<i;e++)Ve.fromBufferAttribute(this,e),Ve.applyMatrix4(t),this.setXYZ(e,Ve.x,Ve.y,Ve.z);return this}applyNormalMatrix(t){for(let e=0,i=this.count;e<i;e++)Ve.fromBufferAttribute(this,e),Ve.applyNormalMatrix(t),this.setXYZ(e,Ve.x,Ve.y,Ve.z);return this}transformDirection(t){for(let e=0,i=this.count;e<i;e++)Ve.fromBufferAttribute(this,e),Ve.transformDirection(t),this.setXYZ(e,Ve.x,Ve.y,Ve.z);return this}getComponent(t,e){let i=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(i=Pi(i,this.array)),i}setComponent(t,e,i){return this.normalized&&(i=Qt(i,this.array)),this.data.array[t*this.data.stride+this.offset+e]=i,this}setX(t,e){return this.normalized&&(e=Qt(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=Qt(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=Qt(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=Qt(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=Pi(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=Pi(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=Pi(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=Pi(e,this.array)),e}setXY(t,e,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=Qt(e,this.array),i=Qt(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this}setXYZ(t,e,i,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=Qt(e,this.array),i=Qt(i,this.array),n=Qt(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this.data.array[t+2]=n,this}setXYZW(t,e,i,n,r){return t=t*this.data.stride+this.offset,this.normalized&&(e=Qt(e,this.array),i=Qt(i,this.array),n=Qt(n,this.array),r=Qt(r,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=i,this.data.array[t+2]=n,this.data.array[t+3]=r,this}clone(t){if(t===void 0){Eu("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let i=0;i<this.count;i++){const n=i*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[n+r])}return new Ni(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new $a(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){Eu("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let i=0;i<this.count;i++){const n=i*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[n+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}let qy=0;class io extends Tr{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:qy++}),this.uuid=vn(),this.name="",this.type="Material",this.blending=uu,this.side=sh,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=fu,this.blendDst=pu,this.blendEquation=du,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ui(0,0,0),this.blendAlpha=0,this.depthFunc=mu,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Mu,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ps,this.stencilZFail=ps,this.stencilZPass=ps,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const i=t[e];if(i===void 0){be(`Material: parameter '${e}' has value of undefined.`);continue}const n=this[e];if(n===void 0){be(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}n&&n.isColor?n.set(i):n&&n.isVector2&&i&&i.isVector2||n&&n.isEuler&&i&&i.isEuler||n&&n.isVector3&&i&&i.isVector3?n.copy(i):this[e]=i}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.shadowSide!==null&&(i.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),this.blending!==uu&&(i.blending=this.blending),this.side!==sh&&(i.side=this.side),this.vertexColors===!0&&(i.vertexColors=!0),this.opacity<1&&(i.opacity=this.opacity),this.transparent===!0&&(i.transparent=!0),this.blendSrc!==fu&&(i.blendSrc=this.blendSrc),this.blendDst!==pu&&(i.blendDst=this.blendDst),this.blendEquation!==du&&(i.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(i.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(i.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(i.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(i.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(i.blendAlpha=this.blendAlpha),this.depthFunc!==mu&&(i.depthFunc=this.depthFunc),this.depthTest===!1&&(i.depthTest=this.depthTest),this.depthWrite===!1&&(i.depthWrite=this.depthWrite),this.colorWrite===!1&&(i.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(i.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Mu&&(i.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(i.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(i.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ps&&(i.stencilFail=this.stencilFail),this.stencilZFail!==ps&&(i.stencilZFail=this.stencilZFail),this.stencilZPass!==ps&&(i.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(i.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(i.rotation=this.rotation),this.polygonOffset===!0&&(i.polygonOffset=!0),this.polygonOffsetFactor!==0&&(i.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(i.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(i.linewidth=this.linewidth),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.dithering===!0&&(i.dithering=!0),this.alphaTest>0&&(i.alphaTest=this.alphaTest),this.alphaHash===!0&&(i.alphaHash=!0),this.alphaToCoverage===!0&&(i.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(i.premultipliedAlpha=!0),this.forceSinglePass===!0&&(i.forceSinglePass=!0),this.allowOverride===!1&&(i.allowOverride=!1),this.wireframe===!0&&(i.wireframe=!0),this.wireframeLinewidth>1&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(i.flatShading=!0),this.visible===!1&&(i.visible=!1),this.toneMapped===!1&&(i.toneMapped=!1),this.fog===!1&&(i.fog=!1),Object.keys(this.userData).length>0&&(i.userData=this.userData);function n(r){const a=[];for(const o in r){const l=r[o];delete l.metadata,a.push(l)}return a}if(e){const r=n(t.textures),a=n(t.images);r.length>0&&(i.textures=r),a.length>0&&(i.images=a)}return i}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new Ui().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new re().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new re().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let i=null;if(e!==null){const n=e.length;i=new Array(n);for(let r=0;r!==n;++r)i[r]=e[r].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}}class Vd extends io{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new Ui(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let ws;const lr=new W,Ts=new W,As=new W,Rs=new re,hr=new re,Gd=new Ye,da=new W,cr=new W,fa=new W,Uu=new re,nl=new re,Ou=new re;class Yy extends li{constructor(t=new Vd){if(super(),this.isSprite=!0,this.type="Sprite",ws===void 0){ws=new ke;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),i=new Xy(e,5);ws.setIndex([0,1,2,0,2,3]),ws.setAttribute("position",new $a(i,3,0,!1)),ws.setAttribute("uv",new $a(i,2,3,!1))}this.geometry=ws,this.material=t,this.center=new re(.5,.5),this.count=1}raycast(t,e){t.camera===null&&yn('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Ts.setFromMatrixScale(this.matrixWorld),Gd.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),As.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Ts.multiplyScalar(-As.z);const i=this.material.rotation;let n,r;i!==0&&(r=Math.cos(i),n=Math.sin(i));const a=this.center;pa(da.set(-.5,-.5,0),As,a,Ts,n,r),pa(cr.set(.5,-.5,0),As,a,Ts,n,r),pa(fa.set(.5,.5,0),As,a,Ts,n,r),Uu.set(0,0),nl.set(1,0),Ou.set(1,1);let o=t.ray.intersectTriangle(da,cr,fa,!1,lr);if(o===null&&(pa(cr.set(-.5,.5,0),As,a,Ts,n,r),nl.set(0,1),o=t.ray.intersectTriangle(da,fa,cr,!1,lr),o===null))return;const l=t.ray.origin.distanceTo(lr);l<t.near||l>t.far||e.push({distance:l,point:lr.clone(),uv:ii.getInterpolation(lr,da,cr,fa,Uu,nl,Ou,new re),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function pa(s,t,e,i,n,r){Rs.subVectors(s,e).addScalar(.5).multiply(i),n!==void 0?(hr.x=r*Rs.x-n*Rs.y,hr.y=n*Rs.x+r*Rs.y):hr.copy(Rs),s.copy(t),s.x+=hr.x,s.y+=hr.y,s.applyMatrix4(Gd)}const qi=new W,sl=new W,ma=new W,gn=new W,rl=new W,ga=new W,al=new W;class Hd{constructor(t=new W,e=new W(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,qi)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const i=e.dot(this.direction);return i<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=qi.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(qi.copy(this.origin).addScaledVector(this.direction,e),qi.distanceToSquared(t))}distanceSqToSegment(t,e,i,n){sl.copy(t).add(e).multiplyScalar(.5),ma.copy(e).sub(t).normalize(),gn.copy(this.origin).sub(sl);const r=t.distanceTo(e)*.5,a=-this.direction.dot(ma),o=gn.dot(this.direction),l=-gn.dot(ma),h=gn.lengthSq(),u=Math.abs(1-a*a);let d,c,f,g;if(u>0)if(d=a*l-o,c=a*o-l,g=r*u,d>=0)if(c>=-g)if(c<=g){const _=1/u;d*=_,c*=_,f=d*(d+a*c+2*o)+c*(a*d+c+2*l)+h}else c=r,d=Math.max(0,-(a*c+o)),f=-d*d+c*(c+2*l)+h;else c=-r,d=Math.max(0,-(a*c+o)),f=-d*d+c*(c+2*l)+h;else c<=-g?(d=Math.max(0,-(-a*r+o)),c=d>0?-r:Math.min(Math.max(-r,-l),r),f=-d*d+c*(c+2*l)+h):c<=g?(d=0,c=Math.min(Math.max(-r,-l),r),f=c*(c+2*l)+h):(d=Math.max(0,-(a*r+o)),c=d>0?r:Math.min(Math.max(-r,-l),r),f=-d*d+c*(c+2*l)+h);else c=a>0?-r:r,d=Math.max(0,-(a*c+o)),f=-d*d+c*(c+2*l)+h;return i&&i.copy(this.origin).addScaledVector(this.direction,d),n&&n.copy(sl).addScaledVector(ma,c),f}intersectSphere(t,e){qi.subVectors(t.center,this.origin);const i=qi.dot(this.direction),n=qi.dot(qi)-i*i,r=t.radius*t.radius;if(n>r)return null;const a=Math.sqrt(r-n),o=i-a,l=i+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const i=-(this.origin.dot(t.normal)+t.constant)/e;return i>=0?i:null}intersectPlane(t,e){const i=this.distanceToPlane(t);return i===null?null:this.at(i,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let i,n,r,a,o,l;const h=1/this.direction.x,u=1/this.direction.y,d=1/this.direction.z,c=this.origin;return h>=0?(i=(t.min.x-c.x)*h,n=(t.max.x-c.x)*h):(i=(t.max.x-c.x)*h,n=(t.min.x-c.x)*h),u>=0?(r=(t.min.y-c.y)*u,a=(t.max.y-c.y)*u):(r=(t.max.y-c.y)*u,a=(t.min.y-c.y)*u),i>a||r>n||((r>i||isNaN(i))&&(i=r),(a<n||isNaN(n))&&(n=a),d>=0?(o=(t.min.z-c.z)*d,l=(t.max.z-c.z)*d):(o=(t.max.z-c.z)*d,l=(t.min.z-c.z)*d),i>l||o>n)||((o>i||i!==i)&&(i=o),(l<n||n!==n)&&(n=l),n<0)?null:this.at(i>=0?i:n,e)}intersectsBox(t){return this.intersectBox(t,qi)!==null}intersectTriangle(t,e,i,n,r){rl.subVectors(e,t),ga.subVectors(i,t),al.crossVectors(rl,ga);let a=this.direction.dot(al),o;if(a>0){if(n)return null;o=1}else if(a<0)o=-1,a=-a;else return null;gn.subVectors(this.origin,t);const l=o*this.direction.dot(ga.crossVectors(gn,ga));if(l<0)return null;const h=o*this.direction.dot(rl.cross(gn));if(h<0||l+h>a)return null;const u=-o*gn.dot(al);return u<0?null:this.at(u/a,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Wd extends io{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Ui(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Rr,this.combine=yy,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const zu=new Ye,Un=new Hd,xa=new Lh,Bu=new W,_a=new W,ya=new W,Ma=new W,ol=new W,va=new W,ku=new W,Sa=new W;class qe extends li{constructor(t=new ke,e=new Wd){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=n.length;r<a;r++){const o=n[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(t,e){const i=this.geometry,n=i.attributes.position,r=i.morphAttributes.position,a=i.morphTargetsRelative;e.fromBufferAttribute(n,t);const o=this.morphTargetInfluences;if(r&&o){va.set(0,0,0);for(let l=0,h=r.length;l<h;l++){const u=o[l],d=r[l];u!==0&&(ol.fromBufferAttribute(d,t),a?va.addScaledVector(ol,u):va.addScaledVector(ol.sub(e),u))}e.add(va)}return e}raycast(t,e){const i=this.geometry,n=this.material,r=this.matrixWorld;n!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),xa.copy(i.boundingSphere),xa.applyMatrix4(r),Un.copy(t.ray).recast(t.near),!(xa.containsPoint(Un.origin)===!1&&(Un.intersectSphere(xa,Bu)===null||Un.origin.distanceToSquared(Bu)>(t.far-t.near)**2))&&(zu.copy(r).invert(),Un.copy(t.ray).applyMatrix4(zu),!(i.boundingBox!==null&&Un.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,e,Un)))}_computeIntersections(t,e,i){let n;const r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,h=r.attributes.uv,u=r.attributes.uv1,d=r.attributes.normal,c=r.groups,f=r.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,_=c.length;g<_;g++){const m=c[g],p=a[m.materialIndex],v=Math.max(m.start,f.start),E=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let M=v,T=E;M<T;M+=3){const b=o.getX(M),A=o.getX(M+1),x=o.getX(M+2);n=ba(this,p,t,i,h,u,d,b,A,x),n&&(n.faceIndex=Math.floor(M/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const g=Math.max(0,f.start),_=Math.min(o.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){const v=o.getX(m),E=o.getX(m+1),M=o.getX(m+2);n=ba(this,a,t,i,h,u,d,v,E,M),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}else if(l!==void 0)if(Array.isArray(a))for(let g=0,_=c.length;g<_;g++){const m=c[g],p=a[m.materialIndex],v=Math.max(m.start,f.start),E=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let M=v,T=E;M<T;M+=3){const b=M,A=M+1,x=M+2;n=ba(this,p,t,i,h,u,d,b,A,x),n&&(n.faceIndex=Math.floor(M/3),n.face.materialIndex=m.materialIndex,e.push(n))}}else{const g=Math.max(0,f.start),_=Math.min(l.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){const v=m,E=m+1,M=m+2;n=ba(this,a,t,i,h,u,d,v,E,M),n&&(n.faceIndex=Math.floor(m/3),e.push(n))}}}}function $y(s,t,e,i,n,r,a,o){let l;if(t.side===_y?l=i.intersectTriangle(a,r,n,!0,o):l=i.intersectTriangle(n,r,a,t.side===sh,o),l===null)return null;Sa.copy(o),Sa.applyMatrix4(s.matrixWorld);const h=e.ray.origin.distanceTo(Sa);return h<e.near||h>e.far?null:{distance:h,point:Sa.clone(),object:s}}function ba(s,t,e,i,n,r,a,o,l,h){s.getVertexPosition(o,_a),s.getVertexPosition(l,ya),s.getVertexPosition(h,Ma);const u=$y(s,t,e,i,_a,ya,Ma,ku);if(u){const d=new W;ii.getBarycoord(ku,_a,ya,Ma,d),n&&(u.uv=ii.getInterpolatedAttribute(n,o,l,h,d,new re)),r&&(u.uv1=ii.getInterpolatedAttribute(r,o,l,h,d,new re)),a&&(u.normal=ii.getInterpolatedAttribute(a,o,l,h,d,new W),u.normal.dot(i.direction)>0&&u.normal.multiplyScalar(-1));const c={a:o,b:l,c:h,normal:new W,materialIndex:0};ii.getNormal(_a,ya,Ma,c.normal),u.face=c,u.barycoord=d}return u}class ah extends io{constructor(t){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Ui(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}}const Za=new W,Ka=new W,Vu=new Ye,ur=new Hd,Ea=new Lh,ll=new W,Gu=new W;class Zy extends li{constructor(t=new ke,e=new ah){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,i=[0];for(let n=1,r=e.count;n<r;n++)Za.fromBufferAttribute(e,n-1),Ka.fromBufferAttribute(e,n),i[n]=i[n-1],i[n]+=Za.distanceTo(Ka);t.setAttribute("lineDistance",new ae(i,1))}else be("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(t,e){const i=this.geometry,n=this.matrixWorld,r=t.params.Line.threshold,a=i.drawRange;if(i.boundingSphere===null&&i.computeBoundingSphere(),Ea.copy(i.boundingSphere),Ea.applyMatrix4(n),Ea.radius+=r,t.ray.intersectsSphere(Ea)===!1)return;Vu.copy(n).invert(),ur.copy(t.ray).applyMatrix4(Vu);const o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,h=this.isLineSegments?2:1,u=i.index,c=i.attributes.position;if(u!==null){const f=Math.max(0,a.start),g=Math.min(u.count,a.start+a.count);for(let _=f,m=g-1;_<m;_+=h){const p=u.getX(_),v=u.getX(_+1),E=wa(this,t,ur,l,p,v,_);E&&e.push(E)}if(this.isLineLoop){const _=u.getX(g-1),m=u.getX(f),p=wa(this,t,ur,l,_,m,g-1);p&&e.push(p)}}else{const f=Math.max(0,a.start),g=Math.min(c.count,a.start+a.count);for(let _=f,m=g-1;_<m;_+=h){const p=wa(this,t,ur,l,_,_+1,_);p&&e.push(p)}if(this.isLineLoop){const _=wa(this,t,ur,l,g-1,f,g-1);_&&e.push(_)}}}updateMorphTargets(){const e=this.geometry.morphAttributes,i=Object.keys(e);if(i.length>0){const n=e[i[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=n.length;r<a;r++){const o=n[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}}function wa(s,t,e,i,n,r,a){const o=s.geometry.attributes.position;if(Za.fromBufferAttribute(o,n),Ka.fromBufferAttribute(o,r),e.distanceSqToSegment(Za,Ka,ll,Gu)>i)return;ll.applyMatrix4(s.matrixWorld);const h=t.ray.origin.distanceTo(ll);if(!(h<t.near||h>t.far))return{distance:h,point:Gu.clone().applyMatrix4(s.matrixWorld),index:a,face:null,faceIndex:null,barycoord:null,object:s}}const Hu=new W,Wu=new W;class Ta extends Zy{constructor(t,e){super(t,e),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,i=[];for(let n=0,r=e.count;n<r;n+=2)Hu.fromBufferAttribute(e,n),Wu.fromBufferAttribute(e,n+1),i[n]=n===0?0:i[n-1],i[n+1]=i[n]+Hu.distanceTo(Wu);t.setAttribute("lineDistance",new ae(i,1))}else be("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class Ky extends Sn{constructor(t,e,i,n,r,a,o,l,h){super(t,e,i,n,r,a,o,l,h),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Nh extends ke{constructor(t=1,e=1,i=4,n=8,r=1){super(),this.type="CapsuleGeometry",this.parameters={radius:t,height:e,capSegments:i,radialSegments:n,heightSegments:r},e=Math.max(0,e),i=Math.max(1,Math.floor(i)),n=Math.max(3,Math.floor(n)),r=Math.max(1,Math.floor(r));const a=[],o=[],l=[],h=[],u=e/2,d=Math.PI/2*t,c=e,f=2*d+c,g=i*2+r,_=n+1,m=new W,p=new W;for(let v=0;v<=g;v++){let E=0,M=0,T=0,b=0;if(v<=i){const w=v/i,C=w*Math.PI/2;M=-u-t*Math.cos(C),T=t*Math.sin(C),b=-t*Math.cos(C),E=w*d}else if(v<=i+r){const w=(v-i)/r;M=-u+w*e,T=t,b=0,E=d+w*c}else{const w=(v-i-r)/i,C=w*Math.PI/2;M=u+t*Math.sin(C),T=t*Math.cos(C),b=t*Math.sin(C),E=d+c+w*d}const A=Math.max(0,Math.min(1,E/f));let x=0;v===0?x=.5/n:v===g&&(x=-.5/n);for(let w=0;w<=n;w++){const C=w/n,P=C*Math.PI*2,D=Math.sin(P),z=Math.cos(P);p.x=-T*z,p.y=M,p.z=T*D,o.push(p.x,p.y,p.z),m.set(-T*z,b,T*D),m.normalize(),l.push(m.x,m.y,m.z),h.push(C+x,A)}if(v>0){const w=(v-1)*_;for(let C=0;C<n;C++){const P=w+C,D=w+C+1,z=v*_+C,X=v*_+C+1;a.push(P,D,z),a.push(D,X,z)}}}this.setIndex(a),this.setAttribute("position",new ae(o,3)),this.setAttribute("normal",new ae(l,3)),this.setAttribute("uv",new ae(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Nh(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}}class Fh extends ke{constructor(t=1,e=1,i=1,n=32,r=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:i,radialSegments:n,heightSegments:r,openEnded:a,thetaStart:o,thetaLength:l};const h=this;n=Math.floor(n),r=Math.floor(r);const u=[],d=[],c=[],f=[];let g=0;const _=[],m=i/2;let p=0;v(),a===!1&&(t>0&&E(!0),e>0&&E(!1)),this.setIndex(u),this.setAttribute("position",new ae(d,3)),this.setAttribute("normal",new ae(c,3)),this.setAttribute("uv",new ae(f,2));function v(){const M=new W,T=new W;let b=0;const A=(e-t)/i;for(let x=0;x<=r;x++){const w=[],C=x/r,P=C*(e-t)+t;for(let D=0;D<=n;D++){const z=D/n,X=z*l+o,N=Math.sin(X),Y=Math.cos(X);T.x=P*N,T.y=-C*i+m,T.z=P*Y,d.push(T.x,T.y,T.z),M.set(N,A,Y).normalize(),c.push(M.x,M.y,M.z),f.push(z,1-C),w.push(g++)}_.push(w)}for(let x=0;x<n;x++)for(let w=0;w<r;w++){const C=_[w][x],P=_[w+1][x],D=_[w+1][x+1],z=_[w][x+1];(t>0||w!==0)&&(u.push(C,P,z),b+=3),(e>0||w!==r-1)&&(u.push(P,D,z),b+=3)}h.addGroup(p,b,0),p+=b}function E(M){const T=g,b=new re,A=new W;let x=0;const w=M===!0?t:e,C=M===!0?1:-1;for(let D=1;D<=n;D++)d.push(0,m*C,0),c.push(0,C,0),f.push(.5,.5),g++;const P=g;for(let D=0;D<=n;D++){const X=D/n*l+o,N=Math.cos(X),Y=Math.sin(X);A.x=w*Y,A.y=m*C,A.z=w*N,d.push(A.x,A.y,A.z),c.push(0,C,0),b.x=N*.5+.5,b.y=Y*.5*C+.5,f.push(b.x,b.y),g++}for(let D=0;D<n;D++){const z=T+D,X=P+D;M===!0?u.push(X,X+1,z):u.push(X+1,X,z),x+=3}h.addGroup(p,x,M===!0?1:2),p+=x}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Fh(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Bn extends Fh{constructor(t=1,e=1,i=32,n=1,r=!1,a=0,o=Math.PI*2){super(0,t,e,i,n,r,a,o),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:i,heightSegments:n,openEnded:r,thetaStart:a,thetaLength:o}}static fromJSON(t){return new Bn(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Uh extends ke{constructor(t=[],e=[],i=1,n=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:i,detail:n};const r=[],a=[];o(n),h(i),u(),this.setAttribute("position",new ae(r,3)),this.setAttribute("normal",new ae(r.slice(),3)),this.setAttribute("uv",new ae(a,2)),n===0?this.computeVertexNormals():this.normalizeNormals();function o(v){const E=new W,M=new W,T=new W;for(let b=0;b<e.length;b+=3)f(e[b+0],E),f(e[b+1],M),f(e[b+2],T),l(E,M,T,v)}function l(v,E,M,T){const b=T+1,A=[];for(let x=0;x<=b;x++){A[x]=[];const w=v.clone().lerp(M,x/b),C=E.clone().lerp(M,x/b),P=b-x;for(let D=0;D<=P;D++)D===0&&x===b?A[x][D]=w:A[x][D]=w.clone().lerp(C,D/P)}for(let x=0;x<b;x++)for(let w=0;w<2*(b-x)-1;w++){const C=Math.floor(w/2);w%2===0?(c(A[x][C+1]),c(A[x+1][C]),c(A[x][C])):(c(A[x][C+1]),c(A[x+1][C+1]),c(A[x+1][C]))}}function h(v){const E=new W;for(let M=0;M<r.length;M+=3)E.x=r[M+0],E.y=r[M+1],E.z=r[M+2],E.normalize().multiplyScalar(v),r[M+0]=E.x,r[M+1]=E.y,r[M+2]=E.z}function u(){const v=new W;for(let E=0;E<r.length;E+=3){v.x=r[E+0],v.y=r[E+1],v.z=r[E+2];const M=m(v)/2/Math.PI+.5,T=p(v)/Math.PI+.5;a.push(M,1-T)}g(),d()}function d(){for(let v=0;v<a.length;v+=6){const E=a[v+0],M=a[v+2],T=a[v+4],b=Math.max(E,M,T),A=Math.min(E,M,T);b>.9&&A<.1&&(E<.2&&(a[v+0]+=1),M<.2&&(a[v+2]+=1),T<.2&&(a[v+4]+=1))}}function c(v){r.push(v.x,v.y,v.z)}function f(v,E){const M=v*3;E.x=t[M+0],E.y=t[M+1],E.z=t[M+2]}function g(){const v=new W,E=new W,M=new W,T=new W,b=new re,A=new re,x=new re;for(let w=0,C=0;w<r.length;w+=9,C+=6){v.set(r[w+0],r[w+1],r[w+2]),E.set(r[w+3],r[w+4],r[w+5]),M.set(r[w+6],r[w+7],r[w+8]),b.set(a[C+0],a[C+1]),A.set(a[C+2],a[C+3]),x.set(a[C+4],a[C+5]),T.copy(v).add(E).add(M).divideScalar(3);const P=m(T);_(b,C+0,v,P),_(A,C+2,E,P),_(x,C+4,M,P)}}function _(v,E,M,T){T<0&&v.x===1&&(a[E]=v.x-1),M.x===0&&M.z===0&&(a[E]=T/2/Math.PI+.5)}function m(v){return Math.atan2(v.z,-v.x)}function p(v){return Math.atan2(-v.y,Math.sqrt(v.x*v.x+v.z*v.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Uh(t.vertices,t.indices,t.radius,t.detail)}}const Aa=new W,Ra=new W,hl=new W,Ca=new ii;class cl extends ke{constructor(t=null,e=1){if(super(),this.type="EdgesGeometry",this.parameters={geometry:t,thresholdAngle:e},t!==null){const n=Math.pow(10,4),r=Math.cos(Ty*e),a=t.getIndex(),o=t.getAttribute("position"),l=a?a.count:o.count,h=[0,0,0],u=["a","b","c"],d=new Array(3),c={},f=[];for(let g=0;g<l;g+=3){a?(h[0]=a.getX(g),h[1]=a.getX(g+1),h[2]=a.getX(g+2)):(h[0]=g,h[1]=g+1,h[2]=g+2);const{a:_,b:m,c:p}=Ca;if(_.fromBufferAttribute(o,h[0]),m.fromBufferAttribute(o,h[1]),p.fromBufferAttribute(o,h[2]),Ca.getNormal(hl),d[0]=`${Math.round(_.x*n)},${Math.round(_.y*n)},${Math.round(_.z*n)}`,d[1]=`${Math.round(m.x*n)},${Math.round(m.y*n)},${Math.round(m.z*n)}`,d[2]=`${Math.round(p.x*n)},${Math.round(p.y*n)},${Math.round(p.z*n)}`,!(d[0]===d[1]||d[1]===d[2]||d[2]===d[0]))for(let v=0;v<3;v++){const E=(v+1)%3,M=d[v],T=d[E],b=Ca[u[v]],A=Ca[u[E]],x=`${M}_${T}`,w=`${T}_${M}`;w in c&&c[w]?(hl.dot(c[w].normal)<=r&&(f.push(b.x,b.y,b.z),f.push(A.x,A.y,A.z)),c[w]=null):x in c||(c[x]={index0:h[v],index1:h[E],normal:hl.clone()})}}for(const g in c)if(c[g]){const{index0:_,index1:m}=c[g];Aa.fromBufferAttribute(o,_),Ra.fromBufferAttribute(o,m),f.push(Aa.x,Aa.y,Aa.z),f.push(Ra.x,Ra.y,Ra.z)}this.setAttribute("position",new ae(f,3))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}}class Oh extends Uh{constructor(t=1,e=0){const i=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],n=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(i,n,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new Oh(t.radius,t.detail)}}class zh extends ke{constructor(t=1,e=1,i=1,n=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:i,heightSegments:n};const r=t/2,a=e/2,o=Math.floor(i),l=Math.floor(n),h=o+1,u=l+1,d=t/o,c=e/l,f=[],g=[],_=[],m=[];for(let p=0;p<u;p++){const v=p*c-a;for(let E=0;E<h;E++){const M=E*d-r;g.push(M,-v,0),_.push(0,0,1),m.push(E/o),m.push(1-p/l)}}for(let p=0;p<l;p++)for(let v=0;v<o;v++){const E=v+h*p,M=v+h*(p+1),T=v+1+h*(p+1),b=v+1+h*p;f.push(E,M,b),f.push(M,T,b)}this.setIndex(f),this.setAttribute("position",new ae(g,3)),this.setAttribute("normal",new ae(_,3)),this.setAttribute("uv",new ae(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new zh(t.width,t.height,t.widthSegments,t.heightSegments)}}class Bh extends ke{constructor(t=.5,e=1,i=32,n=1,r=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:t,outerRadius:e,thetaSegments:i,phiSegments:n,thetaStart:r,thetaLength:a},i=Math.max(3,i),n=Math.max(1,n);const o=[],l=[],h=[],u=[];let d=t;const c=(e-t)/n,f=new W,g=new re;for(let _=0;_<=n;_++){for(let m=0;m<=i;m++){const p=r+m/i*a;f.x=d*Math.cos(p),f.y=d*Math.sin(p),l.push(f.x,f.y,f.z),h.push(0,0,1),g.x=(f.x/e+1)/2,g.y=(f.y/e+1)/2,u.push(g.x,g.y)}d+=c}for(let _=0;_<n;_++){const m=_*(i+1);for(let p=0;p<i;p++){const v=p+m,E=v,M=v+i+1,T=v+i+2,b=v+1;o.push(E,M,b),o.push(M,T,b)}}this.setIndex(o),this.setAttribute("position",new ae(l,3)),this.setAttribute("normal",new ae(h,3)),this.setAttribute("uv",new ae(u,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Bh(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}}class Ns extends ke{constructor(t=1,e=32,i=16,n=0,r=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:i,phiStart:n,phiLength:r,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),i=Math.max(2,Math.floor(i));const l=Math.min(a+o,Math.PI);let h=0;const u=[],d=new W,c=new W,f=[],g=[],_=[],m=[];for(let p=0;p<=i;p++){const v=[],E=p/i,M=a+E*o,T=t*Math.cos(M),b=Math.sqrt(t*t-T*T);let A=0;p===0&&a===0?A=.5/e:p===i&&l===Math.PI&&(A=-.5/e);for(let x=0;x<=e;x++){const w=x/e,C=n+w*r;d.x=-b*Math.cos(C),d.y=T,d.z=b*Math.sin(C),g.push(d.x,d.y,d.z),c.copy(d).normalize(),_.push(c.x,c.y,c.z),m.push(w+A,1-E),v.push(h++)}u.push(v)}for(let p=0;p<i;p++)for(let v=0;v<e;v++){const E=u[p][v+1],M=u[p][v],T=u[p+1][v],b=u[p+1][v+1];(p!==0||a>0)&&f.push(E,M,b),(p!==i-1||l<Math.PI)&&f.push(M,T,b)}this.setIndex(f),this.setAttribute("position",new ae(g,3)),this.setAttribute("normal",new ae(_,3)),this.setAttribute("uv",new ae(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Ns(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class Ja extends ke{constructor(t=1,e=.4,i=12,n=48,r=Math.PI*2,a=0,o=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:i,tubularSegments:n,arc:r,thetaStart:a,thetaLength:o},i=Math.floor(i),n=Math.floor(n);const l=[],h=[],u=[],d=[],c=new W,f=new W,g=new W;for(let _=0;_<=i;_++){const m=a+_/i*o;for(let p=0;p<=n;p++){const v=p/n*r;f.x=(t+e*Math.cos(m))*Math.cos(v),f.y=(t+e*Math.cos(m))*Math.sin(v),f.z=e*Math.sin(m),h.push(f.x,f.y,f.z),c.x=t*Math.cos(v),c.y=t*Math.sin(v),g.subVectors(f,c).normalize(),u.push(g.x,g.y,g.z),d.push(p/n),d.push(_/i)}}for(let _=1;_<=i;_++)for(let m=1;m<=n;m++){const p=(n+1)*_+m-1,v=(n+1)*(_-1)+m-1,E=(n+1)*(_-1)+m,M=(n+1)*_+m;l.push(p,v,M),l.push(v,E,M)}this.setIndex(l),this.setAttribute("position",new ae(h,3)),this.setAttribute("normal",new ae(u,3)),this.setAttribute("uv",new ae(d,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Ja(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}}function Jy(s){const t={};for(const e in s){t[e]={};for(const i in s[e]){const n=s[e][i];if(Xu(n))n.isRenderTargetTexture?(be("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][i]=null):t[e][i]=n.clone();else if(Array.isArray(n))if(Xu(n[0])){const r=[];for(let a=0,o=n.length;a<o;a++)r[a]=n[a].clone();t[e][i]=r}else t[e][i]=n.slice();else t[e][i]=n}}return t}function Xu(s){return s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)}function Qy(s){const t=[];for(let e=0;e<s.length;e++)t.push(s[e].clone());return t}var jy=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,tM=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class eM extends io{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=jy,this.fragmentShader=tM,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Jy(t.uniforms),this.uniformsGroups=Qy(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const n in this.uniforms){const a=this.uniforms[n].value;a&&a.isTexture?e.uniforms[n]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[n]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[n]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[n]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[n]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[n]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[n]={type:"m4",value:a.toArray()}:e.uniforms[n]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const i={};for(const n in this.extensions)this.extensions[n]===!0&&(i[n]=!0);return Object.keys(i).length>0&&(e.extensions=i),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const i in t.uniforms){const n=t.uniforms[i];switch(this.uniforms[i]={},n.type){case"t":this.uniforms[i].value=e[n.value]||null;break;case"c":this.uniforms[i].value=new Ui().setHex(n.value);break;case"v2":this.uniforms[i].value=new re().fromArray(n.value);break;case"v3":this.uniforms[i].value=new W().fromArray(n.value);break;case"v4":this.uniforms[i].value=new qn().fromArray(n.value);break;case"m3":this.uniforms[i].value=new tn().fromArray(n.value);break;case"m4":this.uniforms[i].value=new Ye().fromArray(n.value);break;default:this.uniforms[i].value=n.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}}class Xd{static{Xd.prototype.isMatrix2=!0}constructor(t,e,i,n){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,i,n)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let i=0;i<4;i++)this.elements[i]=t[i+e];return this}set(t,e,i,n){const r=this.elements;return r[0]=t,r[2]=e,r[1]=i,r[3]=n,this}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Ud}}));typeof window<"u"&&(window.__THREE__?be("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Ud);const oh=8,iM=`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`,nM=`
  #define MAX_PULSES ${oh}
  uniform float uTime;
  uniform vec4 uPulse[MAX_PULSES]; // x, z, radius, start time
  uniform int uCount;
  uniform float uSpeed;
  uniform float uFade;
  uniform vec3 uColor;
  uniform vec3 uFront;
  uniform vec3 uPlayer;
  uniform float uKind;     // 0 rock face, 1 edge line, 2 floor
  uniform float uStrength;
  varying vec3 vWorld;

  void main() {
    float glow = 0.0;
    float front = 0.0;
    for (int i = 0; i < MAX_PULSES; i++) {
      if (i >= uCount) break;
      vec4 p = uPulse[i];
      float age = uTime - p.w;
      float wave = age * uSpeed;
      float d = distance(vWorld.xz, p.xy);
      if (d > p.z || d > wave) continue;
      float since = age - d / uSpeed;
      float g = clamp(1.0 - since / uFade, 0.0, 1.0);
      g *= g;
      float rim = smoothstep(p.z, p.z * 0.78, d);
      glow = max(glow, g * rim);
      if (wave < p.z + 0.6) front = max(front, exp(-(wave - d) * (wave - d) * 5.0) * rim);
    }
    // A faint whisker sense right around the creature.
    float near = distance(vWorld.xz, uPlayer.xz);
    float whisker = 0.16 * smoothstep(1.8, 0.4, near);
    glow = max(glow, whisker);

    vec3 col;
    if (uKind > 0.5 && uKind < 1.5) {
      col = mix(uColor, uFront, front) * (glow * 1.1 + front * 1.4);
    } else if (uKind > 1.5) {
      vec2 g = abs(fract(vWorld.xz * 0.5) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.035, min(g.x, g.y));
      col = uColor * (glow * (0.04 + 0.22 * line)) + mix(uColor, uFront, 0.5) * front * (0.05 + 0.55 * line);
    } else {
      float strata = 1.0 - smoothstep(0.0, 0.05, abs(fract(vWorld.y * 1.5 + sin(vWorld.x * 0.9) * 0.15 + cos(vWorld.z * 0.7) * 0.15) - 0.5));
      col = uColor * glow * (0.06 + 0.3 * strata) + uColor * front * (0.12 + 0.3 * strata);
    }
    gl_FragColor = vec4(col * uStrength, 1.0);
  }
`;class sM{constructor({speed:t,fade:e}){this.uniforms={uTime:{value:0},uPulse:{value:Array.from({length:oh},()=>new qn)},uCount:{value:0},uSpeed:{value:t},uFade:{value:e},uPlayer:{value:new W}},this.materials=[]}material(t,{color:e=3139327,front:i=16777215,strength:n=1}={}){const r={face:0,edge:1,floor:2}[t],a=new eM({vertexShader:iM,fragmentShader:nM,uniforms:{...this.uniforms,uColor:{value:new Ui(e)},uFront:{value:new Ui(i)},uKind:{value:r},uStrength:{value:n}},polygonOffset:t!=="edge",polygonOffsetFactor:1,polygonOffsetUnits:1});return a.toneMapped=!1,this.materials.push(a),a}sync(t,e,i){this.uniforms.uTime.value=t;const n=Math.min(oh,e.length);for(let r=0;r<n;r+=1){const a=e[e.length-n+r];this.uniforms.uPulse.value[r].set(a.x,a.z,a.radius,a.time)}this.uniforms.uCount.value=n,this.uniforms.uPlayer.value.set(i.x,0,i.z)}}const De={sonar:3139327,front:16056319,amber:16756794,eye:16721446,player:10474239,beastEcho:16766678,checkpoint:8257496,exit:13629695};function ks(s,t,e=0){let i=s*374761393+t*668265263+e*2147483647|0;return i=Math.imul(i^i>>>13,1274126177),i^=i>>>16,(i>>>0)/4294967295}let dr=null;function rM(){if(dr)return dr;const s=document.createElement("canvas");s.width=s.height=64;const t=s.getContext("2d"),e=t.createRadialGradient(32,32,0,32,32,32);return e.addColorStop(0,"rgba(255,255,255,1)"),e.addColorStop(.25,"rgba(255,255,255,0.45)"),e.addColorStop(1,"rgba(255,255,255,0)"),t.fillStyle=e,t.fillRect(0,0,64,64),dr=new Ky(s),dr.colorSpace=ai,dr}function Cs(s,t,e=1){const i=new Yy(new Vd({map:rM(),color:s,transparent:!0,opacity:e,blending:ka,depthWrite:!1}));return i.scale.setScalar(t),i}function Ri(s,t={}){const e=new Wd({color:s,...t});return e.toneMapped=!1,e}function aM(s){const{cell:t,width:e,height:i}=s,n=.32,r=(d,c)=>{const f=d<=0||c<=0||d>=e||c>=i,g=f?0:(ks(d,c,1)-.5)*2*n,_=f?0:(ks(d,c,2)-.5)*2*n;return[d*t+g,c*t+_]},a=(d,c)=>2.2+ks(d,c,3)*1.6,o=[],l=[],h=(d,c,f,g,_=[])=>{o.push(...d,...c,...f,...d,...f,...g);const m=[d,c,f,g];for(const p of _)l.push(...m[p],...m[(p+1)%4])},u=(d,c,f)=>{const[g,_]=r(d,c);return[g,f??a(d,c),_]};for(let d=0;d<i;d+=1)for(let c=0;c<e;c+=1){if(!Ii(s,c,d))continue;let f=!1;for(let E=-1;E<=1&&!f;E+=1)for(let M=-1;M<=1;M+=1)if(!Ii(s,c+M,d+E)){f=!0;break}if(!f)continue;const g=u(c,d),_=u(c+1,d),m=u(c+1,d+1),p=u(c,d+1);o.push(...g,...p,...m,...g,...m,..._),(c+d)%3===0&&l.push(...g,...m);const v=[[0,-1,[c+1,d],[c,d]],[1,0,[c+1,d+1],[c+1,d]],[0,1,[c,d+1],[c+1,d+1]],[-1,0,[c,d],[c,d+1]]];for(const[E,M,[T,b],[A,x]]of v)Ii(s,c+E,d+M)||h(u(T,b,0),u(A,x,0),u(A,x),u(T,b),[0,2])}return{faces:new Float32Array(o),lines:new Float32Array(l)}}class oM{constructor(t,e){this.host=t,this.rules=e;const i=e.tuning;this.sonar=new sM({speed:i.pulseSpeed,fade:i.echoFade}),this.time=0,this.shake=0,this.cameraTarget=new W,this.beastEchoSeen=new WeakMap,this.bursts=[],this.#e(),this.#i(),this.#n(),this.#s(),this.#r(),this.#a()}#e(){const{level:t}=this.rules,{faces:e,lines:i}=aM(t),n=new ke;n.setAttribute("position",new Ni(e,3));const r=new qe(n,this.sonar.material("face"));r.name="env.cave_walls";const a=new ke;a.setAttribute("position",new Ni(i,3));const o=new Ta(a,this.sonar.material("edge",{color:De.sonar,front:De.front}));o.name="env.cave_edges";const l=t.width*t.cell,h=t.height*t.cell,u=new qe(new zh(l,h),this.sonar.material("floor"));u.rotation.x=-Math.PI/2,u.position.set(l/2,0,h/2),u.name="env.cave_floor";const d=[];for(let f=1;f<t.height-1;f+=1)for(let g=1;g<t.width-1;g+=1){if(Ii(t,g,f))continue;let _=0,m=0,p=0;for(const[E,M]of[[1,0],[-1,0],[0,1],[0,-1]])Ii(t,g+E,f+M)&&(_+=1,m+=E,p+=M);if(_<2||ks(g,f,9)>.55)continue;const v=new Bn(.22+ks(g,f,10)*.25,.5+ks(g,f,11)*1.1,5);v.translate((g+.5+m*.36)*t.cell,v.parameters.height/2,(f+.5+p*.36)*t.cell),d.push(v)}const c=new dn;if(c.add(r,o,u),d.length)for(const f of d){const g=new Ta(new cl(f),this.sonar.material("edge",{strength:.8}));c.add(g),c.add(new qe(f,this.sonar.material("face")))}this.host.add(c,"environment")}#i(){const t=new dn;t.name="chr.player";const e=new qe(new Ns(.28,16,12),Ri(De.player));e.scale.set(1,.75,1.25),e.position.y=.3;const i=new qe(new Bn(.14,.4,8),Ri(6262736));i.rotation.x=-Math.PI/2,i.position.set(0,.28,.42);const n=Cs(De.player,1.6,.55);n.position.y=.3,t.add(e,i,n),this.player=t,this.playerHalo=n;const r=new qe(new Bh(.96,1,96),Ri(De.sonar,{transparent:!0,opacity:.5,blending:ka,depthWrite:!1,side:cu}));r.rotation.x=-Math.PI/2,r.position.y=.05,r.visible=!1,this.chargeRing=r,this.host.add(t,"entities"),this.host.add(r,"entities")}#n(){this.moths=this.rules.moths.map((t,e)=>{const i=new dn;i.name=`prop.moth:${t.id}`;const n=new qe(new Nh(.06,.18,4,8),Ri(16765562));n.rotation.x=Math.PI/2;const r=new ke;r.setAttribute("position",new Ni(new Float32Array([0,0,-.1,.34,0,-.2,.26,0,.16]),3));const a=Ri(De.amber,{side:cu,transparent:!0,opacity:.85}),o=new qe(r,a),l=new qe(r,a);l.scale.x=-1;const h=Cs(De.amber,2.2,.7);return i.add(n,o,l,h),i.position.set(t.x,1.1,t.z),this.host.add(i,"entities"),{id:t.id,group:i,left:o,right:l,halo:h,phase:e*1.7,baseX:t.x,baseZ:t.z}})}#t(){const t=new Ns(.6,7,5);t.scale(.85,.55,1.35),t.translate(0,.55,.1);const e=new Ns(.32,6,4);e.scale(1,.8,1.2),e.translate(0,.62,-.85);const i=new Bn(.22,.5,5);i.rotateX(-Math.PI/2),i.translate(0,.48,-1.2);const n=[t,e,i];for(let r=0;r<6;r+=1){const a=new Bn(.07,.32+Math.sin(r*.9)*.1,4);a.rotateX(.6),a.translate(0,.92-Math.abs(r-2)*.04,-.55+r*.26),n.push(a)}for(const[r,a]of[[-1,-.5],[1,-.5],[-1,.7],[1,.7]]){const o=new Bn(.09,.55,4);o.rotateZ(Math.PI+r*.5),o.translate(r*.55,.25,a),n.push(o)}return n}#s(){const t=this.#t();this.beasts=this.rules.beasts.map(e=>{const i=new dn;i.name=`chr.beast_echo:${e.id}`;for(const o of t){const l=Ri(De.beastEcho,{transparent:!0,opacity:0,blending:ka,depthWrite:!1});i.add(new Ta(new cl(o,25),new ah({color:De.beastEcho,transparent:!0,opacity:0})));const h=new qe(o,l);h.userData.fill=!0,i.add(h)}i.visible=!1;const n=new dn;n.name=`chr.beast:${e.id}`;const r=new dn;for(const o of[-1,1]){const l=new qe(new Ns(.07,8,6),Ri(De.eye));l.position.set(o*.14,.72,-1.05),r.add(l)}const a=Cs(De.eye,1.4,.8);return a.position.set(0,.72,-1.05),r.add(a),r.visible=!1,n.add(r),this.host.add(i,"entities"),this.host.add(n,"entities"),{id:e.id,echo:i,live:n,eyes:r,echoTime:-99}})}#r(){this.checkpoints=this.rules.checkpoints.map(t=>{const e=new dn;e.name=`prop.checkpoint:${t.id}`;const i=new Oh(.35,0);i.scale(1,1.8,1);const n=new qe(i,Ri(De.checkpoint,{transparent:!0,opacity:.25}));n.position.y=.75;const r=new Ta(new cl(i),new ah({color:De.checkpoint,transparent:!0,opacity:.4}));r.position.y=.75;const a=Cs(De.checkpoint,2.4,.15);return a.position.y=.75,e.add(n,r,a),e.position.set(t.x,0,t.z),this.host.add(e,"entities"),{id:t.id,group:e,crystal:n,lines:r,halo:a}})}#a(){const t=this.rules.level.exit,e=new dn;e.name="prop.exit";const i=new qe(new Ja(1.1,.06,6,40),Ri(De.exit,{transparent:!0,opacity:.15}));i.rotation.x=Math.PI/2,i.position.y=.08;const n=[0,1,2].map(()=>{const a=new qe(new Ja(.9,.035,4,40),Ri(De.exit,{transparent:!0,opacity:0,blending:ka,depthWrite:!1}));return a.rotation.x=Math.PI/2,e.add(a),a}),r=Cs(De.exit,5,0);r.position.y=.6,e.add(i,r),e.position.set(t.x,0,t.z),this.host.add(e,"entities"),this.exit={group:e,ring:i,rings:n,halo:r}}burst(t,e,i,n=4){const r=Cs(i,.5,1);r.position.set(t,1,e),this.host.add(r,"entities"),this.bursts.push({sprite:r,age:0,size:n})}onCaught(){this.shake=.6}snapCamera(){const t=this.rules.player;this.cameraTarget.set(t.x,0,t.z)}render(t){this.time+=t;const e=this.rules,i=e,n=i.player;this.sonar.sync(i.clock,i.pulses,n),this.player.position.set(n.x,0,n.z),this.player.rotation.y=n.facing+Math.PI,this.player.children[0].position.y=.3+Math.sin(this.time*6)*.03,this.playerHalo.material.opacity=.45+Math.sin(this.time*2)*.08;const r=i.charge!==null;if(this.chargeRing.visible=r,r){const u=i.chargeRadius();this.chargeRing.scale.setScalar(u),this.chargeRing.position.set(n.x,.05,n.z),this.chargeRing.material.opacity=.25+.3*(u/e.tuning.fullRadius)}for(const u of this.moths){const d=i.moths.find(g=>g.id===u.id);if(u.group.visible=!d.collected,d.collected)continue;const c=this.time+u.phase,f=Math.sin(c*14)*.9;u.left.rotation.z=f,u.right.rotation.z=-f,u.group.position.set(u.baseX+Math.sin(c*.7)*.35,1+Math.sin(c*1.3)*.18,u.baseZ+Math.cos(c*.9)*.35),u.group.rotation.y=c*.6,u.halo.material.opacity=.45+Math.sin(c*3.1)*.2}const a=e.tuning.echoFade;for(const u of this.beasts){const d=i.beasts.find(m=>m.id===u.id);for(const m of i.pulses){let p=this.beastEchoSeen.get(m);if(p||(p=new Set,this.beastEchoSeen.set(m,p)),p.has(u.id))continue;const v=Math.hypot(d.x-m.x,d.z-m.z);if(v>m.radius){p.add(u.id);continue}(i.clock-m.time)*e.tuning.pulseSpeed>=v&&(p.add(u.id),u.echoTime=i.clock,u.echo.position.set(d.x,0,d.z),u.echo.rotation.y=d.facing+Math.PI)}const c=i.clock-u.echoTime,f=Math.max(0,1-c/a);u.echo.visible=f>0;for(const m of u.echo.children)m.material.opacity=m.userData.fill?f*f*.12:f*f;const g=d.state!=="sleeping";u.live.position.set(d.x,0,d.z),u.live.rotation.y=d.facing+Math.PI;const _=d.state==="rousing"?Math.sin(this.time*30)>0?1:.2:1;u.eyes.visible=g&&_>.5,u.eyes.children[2].material.opacity=d.state==="lunging"?1:.7}e.checkpoints.forEach((u,d)=>{const c=this.checkpoints[d],f=d===e.checkpointIndex;c.crystal.rotation.y=this.time*(u.active?.8:.2),c.lines.rotation.y=c.crystal.rotation.y,c.crystal.material.opacity=u.active?.55:.12,c.lines.material.opacity=u.active?.9:.25,c.halo.material.opacity=f?.5+Math.sin(this.time*2)*.1:u.active?.2:.06});const o=e.exitOpen;this.exit.ring.material.opacity=o?.9:.12,this.exit.ring.rotation.z=this.time*.5,this.exit.rings.forEach((u,d)=>{const c=(this.time*.45+d/3)%1;u.position.y=.1+c*2.6,u.scale.setScalar(1-c*.45),u.material.opacity=o?Math.sin(c*Math.PI)*.9:0}),this.exit.halo.material.opacity=o?.8:0,this.bursts=this.bursts.filter(u=>{u.age+=t;const d=u.age/.9;return u.sprite.scale.setScalar(.5+u.size*d),u.sprite.material.opacity=Math.max(0,1-d),d>=1?(this.host.remove(u.sprite),u.sprite.material.dispose(),!1):!0});const l=this.host.camera;this.cameraTarget.lerp(new W(n.x,0,n.z),1-Math.exp(-t*5)),this.shake=Math.max(0,this.shake-t);const h=this.shake*.5;l.position.set(this.cameraTarget.x+(Math.random()-.5)*h,21+(Math.random()-.5)*h,this.cameraTarget.z+10.5),l.lookAt(this.cameraTarget.x,0,this.cameraTarget.z-.5)}}const lM=`
:root { --cyan:#2fe6ff; --amber:#ffb03a; --red:#ff3b3b; --ink:#d9f6ff; }
.eb-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif; color:var(--ink); z-index:5; }
.eb-overlay[hidden] { display:none; }
.eb-screen { position:relative; text-align:center; max-width:640px; padding:24px; }
.eb-title { font-size:clamp(26px, 5vw, 56px); font-weight:200; letter-spacing:.22em; margin:0 0 12px; padding-left:.22em; white-space:nowrap;
  color:#fff; text-shadow:0 0 18px rgba(47,230,255,.7), 0 0 2px #fff; }
.eb-sub { color:rgba(217,246,255,.7); font-size:15px; letter-spacing:.08em; margin:0 0 28px; line-height:1.6; }
.eb-keys { display:grid; grid-template-columns:auto auto; gap:6px 18px; justify-content:center; text-align:left;
  font-size:14px; color:rgba(217,246,255,.82); margin:0 auto 30px; }
.eb-keys b { color:var(--cyan); font-weight:600; text-align:right; }
.eb-btn { pointer-events:auto; background:transparent; color:#fff; border:1px solid rgba(47,230,255,.6);
  padding:12px 30px; font:inherit; font-size:15px; letter-spacing:.2em; text-transform:uppercase; cursor:pointer;
  border-radius:999px; box-shadow:0 0 16px rgba(47,230,255,.25) inset; margin:4px; }
.eb-btn:hover, .eb-btn:focus-visible { background:rgba(47,230,255,.12); outline:none; }
.eb-hint { margin-top:14px; font-size:12px; color:rgba(217,246,255,.45); letter-spacing:.1em; }
.eb-dim { background:rgba(0,0,0,.72); }
.eb-black { background:#000; overflow:hidden; }
.eb-caught { background:radial-gradient(ellipse at center, rgba(60,0,0,.55), rgba(0,0,0,.92)); }
.eb-caught .eb-title { color:#ffd9d9; text-shadow:0 0 18px rgba(255,40,40,.8); font-size:clamp(34px,6vw,58px); }
.eb-stats { display:grid; grid-template-columns:auto auto; gap:8px 28px; justify-content:center; font-size:17px; margin:0 0 28px; }
.eb-stats span:nth-child(odd) { text-align:right; color:rgba(217,246,255,.6); }
.eb-stats span:nth-child(even) { text-align:left; color:#fff; font-variant-numeric:tabular-nums; }
.eb-rings { position:absolute; left:50%; top:50%; pointer-events:none; }
.eb-rings i { position:absolute; left:0; top:0; width:10px; height:10px; margin:-5px; border-radius:50%;
  border:1px solid rgba(47,230,255,.45); animation:eb-ring 4.5s linear infinite; }
.eb-rings i:nth-child(2) { animation-delay:1.5s; } .eb-rings i:nth-child(3) { animation-delay:3s; }
@keyframes eb-ring { from { width:10px; height:10px; margin:-5px; opacity:.9; } to { width:1400px; height:1400px; margin:-700px; opacity:0; } }
@media (prefers-reduced-motion: reduce) { .eb-rings i { animation:none; opacity:.15; width:500px; height:500px; margin:-250px; } }
.a3game-hud-widget.eb-hud { font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif; letter-spacing:.08em;
  font-size:15px; color:var(--ink); }
.a3game-hud-widget.eb-moths { color:var(--amber); font-size:17px; }
.a3game-hud-widget.eb-help { font-size:13px; color:rgba(217,246,255,.6); }
.a3game-hud-widget.eb-toast { font-size:16px; color:#fff; letter-spacing:.14em; text-transform:uppercase;
  text-shadow:0 0 12px rgba(47,230,255,.8); margin-top:18vh; }
.eb-vignette { position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .25s;
  background:radial-gradient(ellipse at center, transparent 45%, rgba(255,0,0,.45)); z-index:4; }
`;function qu(s){const t=Math.floor(s/60),e=Math.floor(s%60);return`${t}:${String(e).padStart(2,"0")}`}class hM{constructor({root:t,hud:e,commands:i}){this.hud=e,this.commands=i;const n=document.createElement("style");n.textContent=lM,document.head.appendChild(n),this.vignette=document.createElement("div"),this.vignette.className="eb-vignette",t.appendChild(this.vignette),this.overlay=document.createElement("div"),this.overlay.className="eb-overlay",this.overlay.id="eb-overlay",t.appendChild(this.overlay),this.overlay.addEventListener("click",r=>{const a=r.target.closest("[data-cmd]");a&&this.commands[a.dataset.cmd]?.()}),e.addText("moths",{anchor:"top-left",value:"",className:"eb-hud eb-moths"}),e.addText("timer",{anchor:"top-right",value:"",className:"eb-hud"}),e.addText("toast",{anchor:"top-center",value:"",className:"eb-hud eb-toast"}),e.addText("help",{anchor:"bottom-left",value:`Tap Space / click: quiet pulse (4 m)
Hold: loud pulse (up to 25 m) - wakes beasts
WASD / arrows: move    Esc: pause`,className:"eb-hud eb-help"}),this.toastTime=0,this.screen=null,this.showTitle()}#e(t,e){this.overlay.className=`eb-overlay ${t}`,this.overlay.innerHTML=e,this.overlay.hidden=!1,this.overlay.querySelector(".eb-btn")?.focus({preventScroll:!0}),this.hud.root.style.visibility="hidden"}hideScreens(){this.overlay.hidden=!0,this.overlay.innerHTML="",this.screen=null,this.hud.root.style.visibility=""}showTitle(){this.screen="title",this.#e("eb-black",`
      <div class="eb-rings"><i></i><i></i><i></i></div>
      <div class="eb-screen" data-screen="title">
        <h1 class="eb-title">ECHOES BELOW</h1>
        <p class="eb-sub">You are small, and blind, and the cave is black. Call into the dark and the rock answers.
        Find the five lost glow-moths and the way out will wake. Something else sleeps down here. Keep it quiet.</p>
        <div class="eb-keys">
          <b>WASD / arrows</b><span>move</span>
          <b>tap Space / click</b><span>quiet pulse, 4 m</span>
          <b>hold Space / mouse</b><span>loud pulse, up to 25 m</span>
          <b>Esc / P</b><span>pause</span>
        </div>
        <button class="eb-btn" data-cmd="start" id="eb-start">Descend</button>
        <div class="eb-hint">Enter to begin. Headphones help.</div>
      </div>`)}showPause(){this.screen="paused",this.#e("eb-dim",`
      <div class="eb-screen" data-screen="paused">
        <h1 class="eb-title" style="font-size:44px">PAUSED</h1>
        <p class="eb-sub">The dark waits.</p>
        <button class="eb-btn" data-cmd="resume">Resume</button>
        <button class="eb-btn" data-cmd="restart">Restart</button>
        <button class="eb-btn" data-cmd="toggleMute" id="eb-mute">Sound: on</button>
        <div class="eb-hint">Esc to resume</div>
      </div>`)}setMuteLabel(t){const e=this.overlay.querySelector("#eb-mute");e&&(e.textContent=`Sound: ${t?"off":"on"}`)}showCaught(){this.screen="caught",this.#e("eb-caught",`
      <div class="eb-screen" data-screen="caught">
        <h1 class="eb-title">CAUGHT</h1>
        <p class="eb-sub">Something in the dark heard you call.</p>
        <button class="eb-btn" data-cmd="respawn">Wake at the last crystal</button>
        <div class="eb-hint">Enter or Space. Your moths stay with you.</div>
      </div>`)}showWin(t){this.screen="won",this.#e("eb-black",`
      <div class="eb-screen" data-screen="won">
        <h1 class="eb-title" style="font-size:clamp(30px,5vw,50px)">OUT OF THE DARK</h1>
        <p class="eb-sub">The moths light your way home.</p>
        <div class="eb-stats">
          <span>Time</span><span id="eb-win-time">${qu(t.time)}</span>
          <span>Pulses</span><span id="eb-win-pulses">${t.pulses}  (${t.tapPulses} quiet, ${t.fullPulses} loud)</span>
          <span>Caught</span><span>${t.deaths} ${t.deaths===1?"time":"times"}</span>
        </div>
        <button class="eb-btn" data-cmd="restart">Play again</button>
      </div>`)}toast(t,e=2.2){this.hud.setValue("toast",t),this.hud.setVisible("toast",!0),this.toastTime=e}flashDanger(t){this.vignette.style.opacity=String(t)}update(t,e){this.hud.setValue("moths",`Glow-moths  ${e.mothsCollected} / ${e.mothsRequired}${e.exit.open?"   -  the way out is open":""}`),this.hud.setValue("timer",`${qu(e.runTime)}    pulses ${e.stats.pulses}`),this.toastTime>0&&(this.toastTime-=t,this.toastTime<=0&&this.hud.setVisible("toast",!1))}}async function cM({viewport:s="#a3game-viewport",hudContainer:t="#a3game-hud"}={}){const e=new sy({container:s,hudContainer:t,antialias:!0,shadows:!1,clearColor:0,pixelRatioCap:1.5,toneMapping:"NoToneMapping",fov:45,far:200,fixedTimeStep:.016666666666666666});await e.init();const i=new xy,n=new oM(e,i);n.snapCamera();const r=new fy,a=new ly({container:e.hudContainer}),o={start:()=>{r.unlock(),i.start()&&(n.snapCamera(),l.hideScreens(),l.toast("Find the five glow-moths",3))},resume:()=>{i.resume()&&l.hideScreens()},pause:()=>{i.pause()&&(r.stopCharge(),l.showPause(),l.setMuteLabel(r.muted))},togglePause:()=>i.phase===$t.PAUSED?o.resume():o.pause(),respawn:()=>{i.respawn()&&(n.snapCamera(),l.hideScreens())},restart:()=>{r.unlock(),i.restart(),n.snapCamera(),l.hideScreens(),l.toast("Find the five glow-moths",3)},toggleMute:()=>{r.setMuted(!r.muted),l.setMuteLabel(r.muted)}},l=new hM({root:e.container.parentElement??document.body,hud:a,commands:o}),h=new dy({target:e.container,controllerId:"player",keyBindings:{Space:"none",ShiftLeft:"none",ShiftRight:"none"},actionBindings:{Space:"pulse",Mouse0:"pulse",Escape:"pause",KeyP:"pause",Enter:"confirm",KeyM:"mute"},lookMode:Ba.DRAG,pointerSensitivity:0});h.enable(),h.onAction((m,p)=>{const v=i.phase;m==="pulse"?p==="pressed"?v===$t.PLAYING?(r.unlock(),i.beginCharge()&&r.startCharge()):v===$t.CAUGHT&&o.respawn():p==="released"&&v===$t.PLAYING&&(i.releasePulse(),r.stopCharge()):m==="pause"&&p==="pressed"?(v===$t.PLAYING||v===$t.PAUSED)&&o.togglePause():m==="confirm"&&p==="pressed"?v===$t.TITLE?o.start():v===$t.CAUGHT?o.respawn():v===$t.PAUSED?o.resume():v===$t.WON&&o.restart():m==="mute"&&p==="pressed"&&o.toggleMute()});const u=()=>{document.hidden&&o.pause()};document.addEventListener("visibilitychange",u);const d=m=>Math.max(-1,Math.min(1,(m-i.player.x)/12));i.on("pulse",m=>r.pulse(m.kind,m.loudness)),i.on("beastWake",m=>{r.growl({pan:d(m.x),distance:m.distance}),l.toast("Something stirs",1.6)}),i.on("beastLunge",m=>{const p=i.beasts.find(v=>v.id===m.id);r.growl({short:!0,pan:d(p.x),distance:1})}),i.on("mothCollected",m=>{r.chime(m.count),n.burst(m.x,m.z,16756794,6),l.toast(m.count>=m.required?"All five moths. The way out wakes.":`Glow-moth ${m.count} of ${m.required}`)}),i.on("exitOpened",()=>r.exitOpened()),i.on("checkpoint",m=>{r.checkpoint(),n.burst(m.x,m.z,8257496,4),l.toast("Crystal lit: you will wake here")}),i.on("caught",()=>{r.stopCharge(),r.caught(),n.onCaught(),l.showCaught()}),i.on("won",m=>{r.win(),l.showWin(m)}),e.onTick(m=>{const p=h.sample();i.update(m,p)});const c=[];let f=performance.now();e.onRender(m=>{const p=performance.now();c.push(p-f),f=p,c.length>120&&c.shift(),n.render(m);const v=i.getState();l.update(m,v);let E=0,M=null;for(const T of i.beasts){if(T.state==="sleeping")continue;const b=Math.hypot(T.x-i.player.x,T.z-i.player.z);E=Math.max(E,Math.max(0,1-b/7))}for(const T of i.moths){if(T.collected)continue;const b=Math.hypot(T.x-i.player.x,T.z-i.player.z);(!M||b<M.distance)&&(M={distance:b,pan:d(T.x)})}l.flashDanger(i.phase===$t.PLAYING?E*.9:0),r.update(m,{playing:i.phase===$t.PLAYING,nearestMoth:M})});const g=()=>c.length<10?0:1e3/(c.reduce((p,v)=>p+v,0)/c.length),_={host:e,input:h,rules:i,commands:o,getState:()=>({...i.getState(),screen:l.screen,fps:Math.round(g()*10)/10}),pathTo:(m,p)=>(Fd(i.level,Ya(i.player.x,i.player.z),Ya(m,p),1e6)??[]).map(v=>({x:(v.col+.5)*i.level.cell,z:(v.row+.5)*i.level.cell}))};return globalThis.__A3GAME_GAME__=_,globalThis.__A3GAME_PLAYTEST__={warmup:.5,look:"off",actions:[{id:"start",taps:["Enter"],duration:.5},{id:"move_north",keys:["KeyW"],duration:1.5},{id:"tap_pulse",taps:["Space"],duration:1.5},{id:"move_west",keys:["KeyA"],duration:1},{id:"loud_pulse",keys:["Space"],duration:1.2},{id:"watch_echo",duration:2.5},{id:"move_south",keys:["KeyS"],duration:1.5}]},e.start(),_}cM().catch(s=>{console.error(s);const t=document.getElementById("boot-error");t&&(t.hidden=!1,t.textContent=`Could not start: ${s.message}`)});
