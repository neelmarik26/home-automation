console.log("pggram run success fully")

// Eye button functionality for password visibility toggle
const passwordInput = document.getElementById("password");
const toggleBtn = document.getElementById("togglePassword");
const eyeIcon = document.getElementById("eyeicon");

if (toggleBtn && passwordInput && eyeIcon) {
    toggleBtn.addEventListener("click", () => {
        const isPassword = passwordInput.type === "password";
        passwordInput.type = isPassword ? "text" : "password";
        
        // Change image based on state
        eyeIcon.src = isPassword ? "assits/closeeye.svg" : "assits/openey.svg";
    });
}

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

        // console.log({ username, email, password });

        senddata({ username, email, password })

    } catch (error) {
        console.error("Error:", error.message);
        const mydiv = document.getElementById('mydiv');
        mydiv.innerHTML = `<div class="message"><div class="mbox">An error occurred. Please try again.</div> `;
    }
});
async function senddata(data) {
    const response = await fetch('/user/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    console.log('Server replied:', result);
    if (response.status !== 201) {
        const mydiv = document.getElementById('mydiv');
        mydiv.innerHTML = `<div class="message"><div class="mbox">${result.message} </div> `
    }
    if(response.status === 201){
        const mydiv = document.getElementById('mydiv');
        mydiv.innerHTML = `<div class="message"><div class="mbox" >${result.message} </div> `
        setTimeout(()=>{
          window.location.href = '/';
        },1500);
    }
}

// reset button functalility 
document.querySelector(".re").addEventListener('click',()=>{
    const emailInput = document.getElementById("email");
    emailInput.value = "";
    const passInput = document.getElementById("password");
    passInput.value = "";
    const nameinput = document.getElementById("name");
    nameinput.value = "";
    
})