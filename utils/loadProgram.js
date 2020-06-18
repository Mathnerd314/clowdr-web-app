const fs = require("fs");
const Parse = require("parse/node");
require('dotenv').config()
var moment = require('moment'); // require
const { exit } = require("process");

if (process.argv.length < 3) {
    console.log('Usage: node utils/loadProgram <CONFERENCE NAME>');
    exit();
}
let conferenceName = process.argv[2];
console.log('Uploading program for ' + conferenceName);

Parse.initialize(process.env.REACT_APP_PARSE_APP_ID, process.env.REACT_APP_PARSE_JS_KEY, process.env.PARSE_MASTER_KEY);
Parse.serverURL = 'https://parseapi.back4app.com/'
Parse.Cloud.useMasterKey();


let data = JSON.parse(fs.readFileSync("data/confero-icse.json"));
let conferoPeople = {};

let i = 0;
data.People.forEach((p) => {
    conferoPeople[p.Key] = p;
})

//Event, Sessions, Items

/*    {
      "Title": "Real-time Multi-user Spatial Collaboration using ARCore",
      "Type": "Talk",
      "Key": "mobilesoft-2020-student-research-competition/3",
      "URL": "https://2020.icse-conferences.org/details/mobilesoft-2020-student-research-competition/3/Real-time-Multi-user-Spatial-Collaboration-using-ARCore",
      "PersonsString": "DongxingCao ",
      "Authors": [
        "dongxingcao"
      ],
      "Affiliations": [
        "Kyungpook National University"
      ],
      "AffiliationsString": "Kyungpook National University",
      "Abstract": "This paper proposes a collaboration application that allows multi-user to add extra content to live video streaming, based on augmented reality annotation in real-time. Compared to the previous work, we think the integration of remote collaboration and a co-located collaborative way is one of the novelty points of the proposed application. The AR-based collaborative system can render annotations directly on an environment which helps local users easily recognize the original intention that the remote helper wants to deliver. We introduce how the application work."
    },*/

async function findOrAddUser(key) {
    if (allUsers[key])
        return allUsers[key];
    else {
        if (conferoPeople[key]) {
            let cp = conferoPeople[key];
            // console.log(cp);
            // console.log(cp.Name);
            if (allUsers[cp.Name])
                return allUsers[cp.Name];
            try {
                // console.log(cp.Name)
                // console.log(Object.keys(allUsers));
                let user = new Parse.User();
                user.set("email", cp.Key + "@clowdr.org");
                user.set("displayname", cp.Name);
                user.set("affiliation", cp.Affiliation);
                user.set("username", cp.Key);
                user.set("password", "abcd" + cp.Key + i + Math.random());
                try {
                    if (cp.URLphoto) {
                        let person = cp;
                        let name = person.URLphoto.substring(person.URLphoto.lastIndexOf("/") + 1);
                        var file = new Parse.File(name, {uri: person.URLphoto});
                        var res = await file.save();
                        console.log(res);
                        user.set("profilePhoto", file);
                    }
                } catch (err) {
                    console.log(err);
                }
                user = await user.signUp();
                allUsers[key] = user;
            } catch (err) {
                console.log(err);
                throw err;
            }
        } else {
            console.log("Missing info for " + key);
        }
    }
    return allUsers[key];
}

async function buildUsersArray(authors) {
    let ret = [];
    for (const author of authors) {
        ret.push(await findOrAddUser(author));
    }
}

let allUsers = {};
let allItems = {};
let allSessions = {};
let daysTillStart = moment("2020-10-06", "YYYY-MM-DD").subtract(moment(moment().format("YYYY-MM-DD")));

function mockDate(date) {
    return date.subtract(daysTillStart);
}

let tracks = {};
data.Items.forEach(item => {
    let parts = item.Key.split("/");
    let trackName = parts[0];
    if (trackName.includes('catering') || trackName == 'icse-2020-test')
        return;
    if (trackName in tracks)
        tracks[trackName] = tracks[trackName] + 1;
    else
        tracks[trackName] = 1;
})


async function loadProgram() {
    let confQ = new Parse.Query("ClowdrInstance")
    confQ.equalTo("conferenceName", conferenceName);
    let conf = await confQ.first();

    let acl = new Parse.ACL();
    acl.setPublicWriteAccess(false);
    acl.setRoleWriteAccess(conf.id+"-manager", true);
    acl.setRoleWriteAccess(conf.id+"-admin", true);

    // Create the tracks first
    let newtracks = [];
    let ProgramTrack = Parse.Object.extend('ProgramTrack');
    var qt = new Parse.Query(ProgramTrack);
    qt.equalTo("conference", conf);
    qt.limit(100);
    var existingTracks = await qt.find();
    for (let [name, count] of Object.entries(tracks)) {
        if (existingTracks.find(t => t.get('name') == name)) {
            console.log('Track already exists: ' + name);
            continue;
        }
        let newtrack = new ProgramTrack();
        newtrack.set('name', name);
        newtrack.set('conference', conf);
        newtrack.setACL(acl);
        newtracks.push(newtrack.save());
        existingTracks.push(newtrack);
    }

    try {
        await Parse.Object.saveAll(newtracks);
    } catch(err){
        console.log(err);
    }
    console.log('Tracks saved: ' + newtracks.length);

    let ProgramItem = Parse.Object.extend("ProgramItem");
    let q = new Parse.Query(ProgramItem);
    q.equalTo("conference", conf);
    q.limit(1000);
    let items = await q.find();
    items.forEach((item) => {
        allItems[item.get("confKey")] = item;
    })
    q = new Parse.Query(Parse.User);
    q.limit(10000);
    let usersArray = await q.find();
    console.log("Found " + usersArray.length);
    usersArray.forEach((u) => {
        allUsers[u.get("displayname")] = u
    });

    let newItems = [];
    for (const item of data.Items) {
        if (allItems[item.Key]) {
            continue
        }
        let parts = item.Key.split("/");
        let trackName = parts[0];
        let track = existingTracks.find(t => t.get('name') == trackName);    
        if (!track)
            console.log('Warning: Adding item without track: ' + item.Key);

        let newItem = new ProgramItem();
        newItem.set("title", item.Title);
        newItem.set("type", item.Type);
        newItem.set("url", item.URL);
        newItem.set("abstract", item.Abstract);
        newItem.set("affiliations", item.Affiliations);
        newItem.set("conference",conf);
        newItem.set("confKey", item.Key);
        newItem.set('track', track);
        newItem.setACL(acl);
        //find affiliated users
        newItem.set("authors", item.Authors);
        newItems.push(newItem);
        allItems[newItem.get("confKey")] = newItem;
    }
    try {
        await Parse.Object.saveAll(newItems);
    } catch(err){
        console.log(err);
    }
    console.log("Items saved: " + newItems.length);

    let ProgramSession = Parse.Object.extend("ProgramSession");
    let qs = new Parse.Query(ProgramSession);
    qs.limit(10000);
    let sessions = await qs.find();
    sessions.forEach((session) => {
        allSessions[session.get("confKey")] = session;
    })

    let toSave = [];
    for (const ses of data.Sessions) {
        // if (i > 1)
        //     continue;
        if (allSessions[ses.Key])
            continue;
        let startTime = ses.Time.substring(0, ses.Time.indexOf('-'));
        let dateTime = ses.Day + " " + startTime;
        //console.log(">" + dateTime)
        var start = moment(dateTime, "YYYY-MM-DD HH:mm");
        var end = moment(dateTime, "YYYY-MM-DD HH:mm");
        // start = mockDate(start).toDate();
        // end = mockDate(end).toDate();

        let session = new ProgramSession();
        session.set("title", ses.Title);
        session.set("abstract", ses.Abstract);
        session.set("type", ses.Type);
        session.set("startTime", start.toDate());
        session.set("endTime", end.toDate());
        session.set("location", ses.Location);
        session.set("confKey", ses.Key);
        session.set("conference", conf);
        session.setACL(acl);

        let items = [];
        if (ses.Items) {
            ses.Items.forEach((k) => {
                if(allItems[k])
                    items.push(allItems[k]);
                else
                    console.log("Could not find item: " + k);
            });
            // await programRef.child("sessions").child(item.Key).child("items").set(items);
        }
        session.set("items", items);
        toSave.push(session);
        // promises.push(session.save({},{useMasterKey: true}));
        // Object.keys(categories).forEach(async (v)=>{
        //     await programRef.child("categories").child("members").child(v).child(item.Key).set(true);
        // })
        // console.log(categories);
        // console.log(item);
        i++;
    }
    try{
        await Parse.Object.saveAll(toSave);
    } catch(err){
        console.log(err);
    }
    console.log("Done");
// data.People.forEach((person)=>{
//     if(person.URLphoto) {
//         // usersRef.child("demo" + i).set({
//         //     email: "demo@no-reply.com",
//         //     username: person.Name,
//         //     photoURL: person.URLphoto
//         // });
//
//         statusRef.child("demo"+i).child("last_changed").set(100+i);
//         i++;
//     }
//
// })

}

loadProgram().then(() => {
    console.log("Done")
});