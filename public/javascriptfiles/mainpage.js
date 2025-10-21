document.getElementById('buttonid1').addEventListener("click" ,()=>{
     const button1=document.getElementById('buttonid1')
     let status=0;
     let id="btn1";
     if(button1.textContent=="off"){
        button1.textContent = 'on';
        console.log("button1 ---" +"1(on)");
        status=1
     }
     else{
        button1.textContent="off"
        console.log("button1---" +"0(off)");
        status=0
     }
     senddatatobackend({id,status})
})
document.getElementById('buttonid2').addEventListener("click" ,()=>{
     const button2=document.getElementById('buttonid2')
     let status=0;
     let id="btn2";
     if(button2.textContent=="off"){
        button2.textContent = 'on';
        console.log( "button2---" +"1(on)");
        status=1;
     }
     else{
        button2.textContent="off"
        console.log("button2---" +"0(off)");
        status=0;
     }
     senddatatobackend({id,status})
})
async function senddatatobackend(data){
    const response = await fetch('/mainpagedata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    console.log('Server replied:', result);
}