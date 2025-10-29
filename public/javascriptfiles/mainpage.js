console.log("pggram run success fully")

window.addEventListener('DOMContentLoaded', function () {
   const token = window.localStorage.getItem('token');
   if (!token) {
      window.location.href = '/';
   }
})

document.getElementById('buttonid1').addEventListener("click", async () => {
   const message = await verifytoken()
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
document.getElementById('buttonid2').addEventListener("click", async () => {
   const message = await verifytoken()
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
// admin token place
const admintoken= "68fda25b462f5ecf5bf4374e";// 68fda25b462f5ecf5bf4374e chenge this for other user admin
// 68fda25b462f5ecf5bf4374e real databace token 
// .........................
// admin page for only valid user 
document.querySelector("#adminbtn").addEventListener('click', async () => {
   if (window.localStorage.getItem('token') === admintoken) {
      document.querySelector(".user-list").innerHTML = ""
      document.getElementById("popup").style.display = "block";
      const result = await alluserinfo();
      document.querySelector(".user-count").innerHTML = result.length
      for (let index = 0; index < result.length; index++) {
         const element = result[index];
         const words = element.name.trim().split(" ");      // split by spaces
         const firstLetter = words[0][0].toUpperCase(); // first letter of first word
         const lastLetter = words[words.length - 1][0].toUpperCase(); // first letter of last word
         const initials = firstLetter + lastLetter;
         if(admintoken!=element._id){
            document.querySelector(".user-list").innerHTML += `<div class="user-card"><div class="user-avatar">${initials}</div><div class="user-info"><div class="user-name">${element.name}</div><div class="user-email">${element.email}</div></div><div class="user-actions"><button class="delete-btn" onclick="deleteUser('${element._id}',this)" title="Delete User"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg></button></div><div class="user-status"></div></div>`
         }
         else{
           document.querySelector(".user-list").innerHTML += `<div class="user-card"><div class="user-avatar">${initials}</div><div class="user-info"><div class="user-name">${element.name}</div><div class="user-email">${element.email}</div></div><div class="adminsng">Admin</div><div class="user-status"></div></div>` 
         }
      }
   }
   else {
      alert("this feture comming soon")
   }
});
// about us button functionality
document.querySelector("#about_us").addEventListener('click', () => {
   alert("this feture comming soon")
})

// function whrite here .................................
function closePopup() {
   popup.style.display = "none";
}
async function alluserinfo() {
   const response = await fetch("/alluserinfo")
   const result = await response.json();
   return (result)
}
async function deleteUser(userid,btn) {
   console.log(userid);
   const response= await fetch ("/userdeleatbyid",{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userid }) })
   const result = await response.json();
   console.log(result.message)
   if (result.action === "deleat") {
    // remove the whole user card from DOM
    const userCard = btn.closest(".user-card"); // find parent div with class 'user-card'
    if (userCard) userCard.remove();
    document.querySelector(".user-count").innerHTML -=1;
  }
}
// esp pass word change functanility 