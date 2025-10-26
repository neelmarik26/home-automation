console.log("pggram run success fully")

window.addEventListener('DOMContentLoaded', function () {
   const token = window.localStorage.getItem('token');
   if (!token) {
      window.location.href = '/';
   }
})

document.getElementById('buttonid1').addEventListener("click", async () => {
   const message= await verifytoken()
   if (message == "token is not found") {
      window.localStorage.removeItem('token');
      window.location.href = '/';
   }
   else {
      const button1 = document.getElementById('buttonid1')
      let status = 0;
      let id = "btn1";
      if (button1.textContent == "off") {
         button1.textContent = 'on';
         console.log("button1 ---" + "1(on)");
         status = 1
      }
      else {
         button1.textContent = "off"
         console.log("button1---" + "0(off)");
         status = 0
      }
      senddatatobackend({ id, status })
   }
})
document.getElementById('buttonid2').addEventListener("click", async() => {
   const message=await verifytoken()
   if (message == "token is not found") {
      window.localStorage.removeItem('token');
      window.location.href = '/';
   } else {
      const button2 = document.getElementById('buttonid2')
      let status = 0;
      let id = "btn2";
      if (button2.textContent == "off") {
         button2.textContent = 'on';
         console.log("button2---" + "1(on)");
         status = 1;
      }
      else {
         button2.textContent = "off"
         console.log("button2---" + "0(off)");
         status = 0;
      }
      senddatatobackend({ id, status })
   }
})
async function senddatatobackend(data) {
   const response = await fetch('/mainpagedata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
   const result = await response.json();
   console.log('Server replied:', result);
}
document.getElementById('logout').addEventListener("click", () => {
   window.localStorage.removeItem('token');
   window.location.href = '/';
})
async function verifytoken() {
   const usertoken = window.localStorage.getItem('token')
   const response = await fetch('/mainpagetoken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usertoken }) })
   const result = await response.json();
   console.log('Server replied:', result.message);
   return result.message 
}
// admin page for only valid user 
document.querySelector("#adminbtn").addEventListener('click',()=>{
   alert("this feture comming soon")
})
// about us button functionality
document.querySelector("#about_us").addEventListener('click',()=>{
   alert("this feture comming soon")
})