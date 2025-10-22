console.log("pggram run success fullyghm")

const signupBtn = document.getElementById("singupbtn");
if (signupBtn) {
    signupBtn.addEventListener("click", () => {
        callsinguppage();
    });
} 
else {
    console.error("Signup button not found!");
}
async function callsinguppage() {
    window.location.href = '/singuppage';
}
async function callmainpage(){
    window.location.href = '/mainpage';
}
document.querySelector('.btn').addEventListener('click', () => {
        const emailinput = document.querySelector('#emailinput');
        const passwordinput = document.querySelector('#passwordinput');
        const email = emailinput.value;
        const password = passwordinput.value;
        console.log(email, password);
        senddata({email,password})
})
async function senddata(data) {
    try{
        const response = await fetch('/olduser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await response.json();
        console.log('Server replied:', result);
        if(result.pass=="match"){
            document.querySelector('.messagebox').innerHTML=`<div> welcome back </div>`
            setTimeout(()=>{
            callmainpage();
            },1500)
        }
        else if(result.reply=="no user found"){
            document.querySelector('.messagebox').innerHTML=`<div>no user found</div>`
        }
        else if(result.pass="notmatch"){
           document.querySelector('.messagebox').innerHTML=`<div>you enter wrong password</div>` 
        }
    }catch(e){
        console.log(e.message)
    }
}