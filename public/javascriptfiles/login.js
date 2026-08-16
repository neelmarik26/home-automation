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
        document.querySelector('.messagebox').innerHTML = `<div>${result.message}</div>`
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
    // Reset the forgot password form
    document.getElementById('otpSection').style.display = 'none';
    document.getElementById('sendOtp').style.display = 'block';
    document.getElementById('verifyOtp').style.display = 'none';
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach(input => {
        input.value = '';
    });
    document.getElementById('forgetemail').value = '';
    document.getElementById('error').innerHTML = '';
}
function forgotPassword(params) {
    document.getElementById('forgotPasswordPopup').classList.add('active');
}
async function otpmakeandsend() {
    const usermail = document.querySelector('#forgetemail').value;
    const response = await fetch('/user/sendmail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usermail}) })
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.message || 'Failed to send OTP');
    }
    return result
}
async function sendotp() {
    const usermail = document.querySelector('#forgetemail').value;
    if(!usermail || !isValidEmail(usermail)){
        document.getElementById('error').innerHTML = "invalid email"
        return;
    }
    if (isValidEmail(usermail)) {
        try {
            const result = await otpmakeandsend(); // backend sends OTP and returns { message, otp }

            if (result.status === true) {
                // Show OTP section, hide send button
                document.getElementById('otpSection').style.display = 'block';
                document.getElementById('sendOtp').style.display = 'none';

                const verifyBtn = document.getElementById('verifyOtp');
                verifyBtn.style.display = 'block'; // show verify button
                verifyBtn.replaceWith(verifyBtn.cloneNode(true)); // remove old event listeners
                const newVerifyBtn = document.getElementById('verifyOtp');
                newVerifyBtn.onclick = submitotp; // attach click handler

                // Setup OTP input handling
                setupOTP((isComplete, otp) => {
                    if (isComplete) {
                        newVerifyBtn.style.display = 'block';
                        console.log("ok otp")
                    } else {
                        newVerifyBtn.style.display = 'none';
                        console.log("wrong otp")
                    }
                });
            }
        } catch (error) {
            // Show error message in the error div
            document.getElementById('error').innerHTML = error.message || 'Failed to send OTP. Please try again.';
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
    // Clear previous error message
    document.getElementById('error').innerHTML = '';
    try {
        await sendotp();
    } catch (error) {
        // Show error message in the error div
        document.getElementById('error').innerHTML = error.message || 'Failed to resend OTP. Please try again.';
    }
}

// write code for change pass word
async function submitotp() {
    const usermail = document.querySelector('#forgetemail').value;
    const inputs = document.querySelectorAll('.otp-digit');
    const otp = Array.from(inputs).map(i => i.value).join('');
    
    if (!otp || otp.length !== 6) {
        document.getElementById('error').innerHTML = "Please enter the complete 6-digit OTP";
        return;
    }
    
    try {
        const response = await fetch('/user/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usermail, otp })
        });
        const result = await response.json();
        
        if (response.ok && result.status === true) {
            // OTP verified successfully, show new password popup
            document.getElementById('forgotPasswordPopup').classList.remove('active');
            document.getElementById('newpassword-popup').classList.add('active');
            document.getElementById('error').innerHTML = '';
            
            // Reset the forgot password form for next time
            document.getElementById('otpSection').style.display = 'none';
            document.getElementById('sendOtp').style.display = 'block';
            document.getElementById('verifyOtp').style.display = 'none';
            inputs.forEach(input => {
                input.value = '';
            });
        } else {
            document.getElementById('error').innerHTML = result.message || 'Invalid OTP';
        }
    } catch (error) {
        document.getElementById('error').innerHTML = error.message || 'Failed to verify OTP. Please try again.';
    }
}
document.getElementById('closePopupf').addEventListener('click', () => {
    document.getElementById('newpassword-popup').classList.remove('active');
    // Reset the new password form
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    document.getElementById('givemsg').innerHTML = 'Set New Password';
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
        const response = await fetch('/user/cpass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usermail, newpassword}) })
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

// Eye button functionality for new password field
const newPasswordInput = document.getElementById("newPassword");
const toggleNewPasswordBtn = document.getElementById("toggleNewPassword");
const eyeIconNew = document.getElementById("eyeicon-new");
if (toggleNewPasswordBtn && newPasswordInput && eyeIconNew) {
    toggleNewPasswordBtn.addEventListener("click", () => {
        const isPassword = newPasswordInput.type === "password";
        newPasswordInput.type = isPassword ? "text" : "password";
        eyeIconNew.src = isPassword ? "assits/closeeye.svg" : "assits/openey.svg";
    });
}

// Eye button functionality for confirm password field
const confirmPasswordInput = document.getElementById("confirmPassword");
const toggleConfirmPasswordBtn = document.getElementById("toggleConfirmPassword");
const eyeIconConfirm = document.getElementById("eyeicon-confirm");
if (toggleConfirmPasswordBtn && confirmPasswordInput && eyeIconConfirm) {
    toggleConfirmPasswordBtn.addEventListener("click", () => {
        const isPassword = confirmPasswordInput.type === "password";
        confirmPasswordInput.type = isPassword ? "text" : "password";
        eyeIconConfirm.src = isPassword ? "assits/closeeye.svg" : "assits/openey.svg";
    });
}
