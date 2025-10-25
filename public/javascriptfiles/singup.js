console.log("pggram run success fully")

document.querySelector(".sub").addEventListener("click", (e) => {
    e.preventDefault();

    try {
        const nameInput = document.querySelector("#name");
        const emailInput = document.querySelector("#email");
        const passwordInput = document.querySelector("#password");

        // Check if elements exist
        if (!nameInput || !emailInput || !passwordInput) {
            throw new Error("Form elements not found");
        }

        const username = nameInput.value;
        const email = emailInput.value;
        const password = passwordInput.value;

        // Validation
        if (!username.trim()) {
            const mydiv = document.getElementById('mydiv');
            mydiv.innerHTML = `<div class="message"><div class="mbox">Please enter a username</div> `
            return;
        }

        if (!email.includes('@')) {
            const mydiv = document.getElementById('mydiv');
            mydiv.innerHTML = `<div class="message"><div class="mbox">Please enter a valid email</div> `
            return;
        }

        if (password.length < 8) {
            const mydiv = document.getElementById('mydiv');
            mydiv.innerHTML = `<div class="message"><div class="mbox">Password must be at least 8 characters</div> `
            return;
        }

        console.log({ username, email, password });

        senddata({ username, email, password })

    } catch (error) {
        console.error("Error:", error.message);
        alert("An error occurred: " + error.message);
    }
});
async function senddata(data) {
    const response = await fetch('/newuser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    console.log('Server replied:', result);
    if (result.e == "error occer") {
        const mydiv = document.getElementById('mydiv');
        mydiv.innerHTML = `<div class="message"><div class="mbox">${result.message} </div> `
    }
    if(result.reply=="welcome!"){
        const mydiv = document.getElementById('mydiv');
        mydiv.innerHTML = `<div class="message"><div class="mbox" >${result.reply} </div> `
        setTimeout(()=>{
         callmainpage();
        },1000);
    }
}
async function callmainpage(){
    window.location.href = '/mainpage';
}
document.querySelector(".re").addEventListener('click',()=>{
    const emailInput = document.getElementById("email");
    emailInput.value = "";
    const passInput = document.getElementById("password");
    passInput.value = "";
    const nameinput = document.getElementById("name");
    nameinput.value = "";
    
})