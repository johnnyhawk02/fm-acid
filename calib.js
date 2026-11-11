// open-loop response of diode ladder with caps [18n,33n,33n,33n], equal G
const C=[18e-9,33e-9,33e-9,33e-9];
function H(w,G){ // solve (jw - M)v = B x, x=1
  // complex gaussian elim
  const n=4; const A=[]; 
  const M=[[-G/C[0],G/C[0],0,0],[G/C[1],-2*G/C[1],G/C[1],0],[0,G/C[2],-2*G/C[2],G/C[2]],[0,0,G/C[3],-2*G/C[3]]];
  const b=[[G/C[0],0],[0,0],[0,0],[0,0]];
  for(let i=0;i<n;i++){A.push([]);for(let j=0;j<n;j++)A[i].push([-M[i][j],i==j?w:0]);A[i].push(b[i]);}
  const mul=(a,c)=>[a[0]*c[0]-a[1]*c[1],a[0]*c[1]+a[1]*c[0]];
  const div=(a,c)=>{const d=c[0]*c[0]+c[1]*c[1];return [(a[0]*c[0]+a[1]*c[1])/d,(a[1]*c[0]-a[0]*c[1])/d]};
  for(let i=0;i<n;i++){for(let r=i+1;r<n;r++){const f=div(A[r][i],A[i][i]);for(let j=i;j<=n;j++){const p=mul(f,A[i][j]);A[r][j]=[A[r][j][0]-p[0],A[r][j][1]-p[1]];}}}
  const x=[];for(let i=n-1;i>=0;i--){let s=A[i][n];for(let j=i+1;j<n;j++){const p=mul(A[i][j],x[j]);s=[s[0]-p[0],s[1]-p[1]];}x[i]=div(s,A[i][i]);}
  return x[3];
}
const G=1e-4; // arbitrary
let prev=null;
for(let f=1;f<200000;f*=1.0005){const h=H(2*Math.PI*f,G);if(h[1]>=0&&h[0]<0&&prev){} // imag crossing
 if(prev&&prev[1]<0&&h[1]>=0&&h[0]<0){console.log('f180',f,'|H|',Math.hypot(...h),'kcrit',1/Math.hypot(...h),'f180/(G/C33/2pi)',f/(G/33e-9/2/Math.PI));break;}
 prev=h;}
console.log('DC',H(1e-3,G));
