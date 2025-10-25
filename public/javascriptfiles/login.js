console.log("pggram run success fully")

window.addEventListener('DOMContentLoaded', function() {
    const token = window.localStorage.getItem('token');
    const currentPath = window.location.pathname;
    if (!token && currentPath !== '/') {
        // No token and not already on home page - redirect to login
        window.location.href = '/';
    } else if (token && currentPath === '/') {
        // Has token and is on home page - redirect to main page
        window.location.href = '/mainpage';
    }
    // Otherwise, stay on current page
});

document.getElementById("singupbtn").addEventListener("click", (event) => {
        event.preventDefault();
        callsinguppage();
    });

function callsinguppage() {
    window.location.href = '/supage';
}

async function callmainpage(token){
    window.localStorage.setItem("token",token)
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
            callmainpage(result.token);
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