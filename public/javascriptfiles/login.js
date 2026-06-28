console.log("pggram run success fully")

window.addEventListener('DOMContentLoaded', function () {
    const token = window.localStorage.getItem('token');
    const currentPath = window.location.pathname;
    const lockEnd = localStorage.getItem("lockEnd");
    if (lockEnd && Date.now() < lockEnd) {
        const remaining = Math.ceil((lockEnd - Date.now()) / 1000);
        startCountdown(remaining);
    }
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

async function callmainpage(result) {
    window.localStorage.setItem("token",result.token)
    window.localStorage.setItem("user",JSON.stringify(result.user))
    window.location.href = '/mainpage';
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
document.querySelector('#login').addEventListener('click', (event) => {
    event.preventDefault();
    const emailinput = document.querySelector('#emailinput');
    const passwordinput = document.querySelector('#passwordinput');
    const email = emailinput.value;
    const password = passwordinput.value;
    if(!email || !password || !isValidEmail(email) ){
        document.getElementById('mxbox').innerHTML="Email or Password is wrong!"
    }else{
        senddata({ email, password })
    }
});
async function senddata(data) {
    try {
        const response = await fetch('/user/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await response.json();
        console.log('Server replied:', result,response.status);
        if (response.status === 200) {
            document.querySelector('.messagebox').innerHTML = `<div> welcome back </div>`
            setTimeout(() => {
                callmainpage(result);
            }, 1500)
        }
        if (response.status !==200 ) {
            document.querySelector('.messagebox').innerHTML = `<div>${result.message}</div>`
        }
       
    } catch (e) {
        console.log(e.message)
    }
}
let timerInterval = null;
function startCountdown(seconds) {
    const messageBox = document.querySelector('.messagebox');
    const loginButton = document.querySelector('.btn');
    const lockEnd = Date.now() + seconds * 1000;
    localStorage.setItem("lockEnd", lockEnd);
    loginButton.disabled = true;

    let remaining = seconds;
    messageBox.innerHTML = `<div style="color:red;">Try again in ${remaining}s</div>`;

    timerInterval = setInterval(() => {
        remaining--;
        messageBox.innerHTML = `<div style="color:red;">Try again in ${remaining}s</div>`;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            messageBox.innerHTML = `<div>You can try logging in again now.</div>`;
            loginButton.disabled = false;
        }
    }, 1000);
}

// forget passwor window


function isValidEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    console.log(regex.test(email))
    console.log(email)
    return regex.test(email);
}
function closepopup() {
    document.getElementById('forgotPasswordPopup').classList.remove('active');
}
function forgotPassword(params) {
    document.getElementById('forgotPasswordPopup').classList.add('active');
}
async function otpmakeandsend() {
    const usermail = document.querySelector('#forgetemail').value;
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    // console.log(otp)
    const response = await fetch('/sendmail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usermail, otp }) })
    const result = await response.json();
    console.log('Server replied:', result.message);
    return result
}
async function sendotp() {
    const usermail = document.querySelector('#forgetemail').value;
    if (isValidEmail(usermail)) {
        const result = await otpmakeandsend(); // backend sends OTP and returns { message, otp }

        if (result.message === " i get this") {
            // Show OTP section, hide send button
            document.getElementById('otpSection').style.display = 'block';
            document.getElementById('sendOtp').style.display = 'none';

            const verifyBtn = document.getElementById('verifyOtp');
            verifyBtn.style.display = 'none'; // hide until OTP complete
            verifyBtn.replaceWith(verifyBtn.cloneNode(true)); // remove old event listeners
            const newVerifyBtn = document.getElementById('verifyOtp');

            // Setup OTP input handling
            setupOTP((isComplete, otp) => {
                if (isComplete && otp === result.otp) {
                    newVerifyBtn.style.display = 'block';
                    console.log("ok otp")
                } else {
                    newVerifyBtn.style.display = 'none';
                    console.log("wrong otp")
                }
            });
        }
    } else {
        console.log("Invalid email format");
    }
}

// })
function setupOTP(onStatusChange) {
    const inputs = document.querySelectorAll(".otp-digit");
    if (!inputs.length) return;

    inputs[0].focus();

    inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
            input.value = input.value.replace(/\D/g, '');

            if (input.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }

            const otp = Array.from(inputs).map(i => i.value).join('');
            const allFilled = otp.length === inputs.length;

            // Call the callback function with status and value
            onStatusChange(allFilled, otp);
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

async function restartfullsection() {
    document.getElementById('otpSection').style.display = 'none';
    document.getElementById('verifyOtp').style.display = 'none';
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach(input => {
        input.value = '';
    });
    await sendotp()
}

// write code for change pass word
function submitotp() {
    document.getElementById('forgotPasswordPopup').classList.remove('active');
    document.getElementById('newpassword-popup').classList.add('active');
}
document.getElementById('closePopupf').addEventListener('click', () => {
    document.getElementById('newpassword-popup').classList.remove('active');
});



async function updatepass() {
    console.log("l am update pass")
    const passwordInput = document.getElementById("newPassword");
    const password = passwordInput.value;

    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    let message = "";

    if (!hasUppercase) {
        message = "Add at least one uppercase letter.";
    } else if (!hasLowercase) {
        message = "Add at least one lowercase letter.";
    } else if (!hasNumber) {
        message = "Include at least one number.";
    } else if (!hasSpecial) {
        message = "Include at least one special character.";
    } else {
        const conpassinput = document.getElementById("confirmPassword");
        const conformpass = conpassinput.value;
        console.log(password, conformpass)
        if (conformpass === password) {
            message = "all ok boss"
        }
        else {
            message = "2 password are not match"
        }
    }
    await savetodb(message, password);
};

async function savetodb(message, newpassword) {
    if (message === "all ok boss") {
        const usermail = document.querySelector('#forgetemail').value;
        // console.log(usermail, message, newpassword)
        const response = await fetch('/cpass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usermail, newpassword }) })
        const result = await response.json();
        console.log('Server replied:', result.message);
        document.getElementById('givemsg').innerHTML = result.message;
        if (result.message === "Password updated successfully") {
            document.getElementById('mxbox').innerHTML=result.message
            document.getElementById('newpassword-popup').classList.remove('active');
            console.log("hello i run when pass chenge");
        }
    }
    else {
        console.log(message);
        document.getElementById('givemsg').innerHTML = message
    }
}

// eye button functanaility 
const passwordInput = document.getElementById("passwordinput");
const toggleBtn = document.getElementById("togglePassword");
const eyeIcon = document.getElementById("eyeicon");
toggleBtn.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  
  // Change image based on state
  eyeIcon.src = isPassword ? "assits/closeeye.svg" : "assits/openey.svg";
});
