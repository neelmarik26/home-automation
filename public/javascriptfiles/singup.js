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
            alert("Please enter a username");
            return;
        }
        
        if (!email.includes('@')) {
            alert("Please enter a valid email");
            return;
        }
        
        if (password.length < 8) {
            alert("Password must be at least 8 characters");
            return;
        }
        
        console.log( { username, email, password });
        
        senddata({ username, email, password })
        
    } catch (error) {
        console.error("Error:", error.message);
        alert("An error occurred: " + error.message);
    }
});
async function senddata(data){
    const response = await fetch('/newuser', {method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(data)});
    const result = await response.json();
    console.log('Server replied:', result);
}