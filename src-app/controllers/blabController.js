
const mariadb = require('mariadb');
const pyformat = require('pyformat');
const dbconnector = require('../utils/dbconnector.js');
var Blab = require('../models/Blab');
var Blabber = require('../models/Blabber');
var Comment = require('../models/Comment');
const { nextDay } = require('date-fns');
const moment = require('moment')
const IgnoreCommand = require('../commands/IgnoreCommand');
const ListenCommand = require('../commands/ListenCommand');

//require('../models/Blab.js')


const sqlBlabsByMe = "SELECT blabs.content, blabs.timestamp, COUNT(comments.blabber), blabs.blabid "
        + "FROM blabs LEFT JOIN comments ON blabs.blabid = comments.blabid "
        + "WHERE blabs.blabber = ? GROUP BY blabs.blabid ORDER BY blabs.timestamp DESC;";

const sqlBlabsForMe = "SELECT users.username, users.blab_name, blabs.content, blabs.timestamp, COUNT(comments.blabber), blabs.blabid "
        + "FROM blabs INNER JOIN users ON blabs.blabber = users.username INNER JOIN listeners ON blabs.blabber = listeners.blabber "
        + "LEFT JOIN comments ON blabs.blabid = comments.blabid WHERE listeners.listener = ? "
        + "GROUP BY blabs.blabid ORDER BY blabs.timestamp DESC LIMIT {} OFFSET {};";

/*
*   TODO: Fix setCommentCount() to contain comment count. Currently does not work.
*/
async function showFeed(req, res){
    
    console.log("Entering showFeed");

    let username = req.session.username;
    // Ensure user is logged in
    if (!username) 
    {
        console.log("User is not Logged In - redirecting...");
        return res.redirect("login?target=feed");
    }

    console.log("User is Logged In - continuing... UA=", req.headers['user-agent'], " U=", username);
    let connect = null;
    
    try {
        console.log("Getting Database connection");
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());
        

        // Find the Blabs that this user listens to
        console.log("Preparing the BlabsForMe Prepared Statement");
        blabsForMe = await connect.prepare(pyformat(sqlBlabsForMe, [10, 0]));
        console.log("Executing the BlabsForMe Prepared Statement");
        let blabsForMeResults = await blabsForMe.execute(username);

        // Store them in the Model
        feedBlabs = [];
        for (item of blabsForMeResults) {
            let author = new Blabber();
            author.setUsername(item['username']);
            author.setBlabName(item['blab_name']);

            let post = new Blab();
            post.setId(item['blabid']);
            post.setContent(item['content']);
            post.setPostDate(item['timestamp']);
            post.setCommentCount(item['COUNT']);
            post.setAuthor(author);

            feedBlabs.push(post);
        }
        res.locals['blabsByOthers'] = feedBlabs;
        res.locals['currentUser'] = username;

        // Find the Blabs by this user
        blabsByMe = await connect.prepare(sqlBlabsByMe);
        console.log("Executing the BlabsByMe Prepared Statement");
        let blabsByMeResults = await blabsByMe.execute(username);

        // Store them in the model
        myBlabs = [];
        for (item of blabsByMeResults) {
            post = new Blab();
            post.setId(item['blabid']);
            post.setContent(item['content']);
            post.setPostDate(item['timestamp']);
            post.setCommentCount(item['COUNT']);

            myBlabs.push(post);
        }
        res.locals['blabsByMe'] = myBlabs;
    } catch (err) {
        console.error("Error connecting to database and querying data: ", err);
    } finally {
        if (connect) connect.end(err => {
            if(err) {
               console.log("SQL error in closing connection: ", err);
            }
         })
    }
    return res.render('feed',{});
}
async function getMoreFeed(req,res){
    const count = req.query.count;
    const length = req.query.len;
    // const template = "<li><div>" + "\t<div class=\"commenterImage\">" + "\t\t<img src=\"/images/{username}.png\">"
	// 			+ "\t</div>" + "\t<div class=\"commentText\">" + "\t\t<p>{content}</p>"
	// 			+ "\t\t<span class=\"date sub-text\">by {blab_name} on {timestamp}</span><br>"
	// 			+ "\t\t<span class=\"date sub-text\"><a href=\"blab?blabid={blabid}\">{count} Comments</a></span>" + "\t</div>"
	// 			+ "</div></li>";

    const template = "<li><div>" + "\t<div class=\"commenterImage\">" + "\t\t<img src=\"/images/{username}.png\">"
				+ "\t</div>" + "\t<div class=\"commentText\">" + "\t\t<p>THE PROBLEM IS HERE</p>"
				+ "\t\t<span class=\"date sub-text\">by {blab_name} on {timestamp}</span><br>"
				+ "\t\t<span class=\"date sub-text\"><a href=\"#\">{count} Comments</a></span>" + "\t</div>"
				+ "</div></li>";

    let cnt = null;
    let len = null;
                
    try {
        // Convert input to integers
        cnt = Number(count);
        len = Number(length);
    } catch (err) {
        console.error(err);
        return ""
    }
    username = req.session.username;

    // Get the Database Connection
    let connect;
    let feedSql;
    let ret = [];
    try {
        console.log("Creating database connection");
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());
        console.log("Creating prepared statement");
        feedSql = await connect.prepare(pyformat(sqlBlabsForMe, [len,cnt]));

        let results = await feedSql.execute(username);
        for (item of results)
        {
            blab = new Blab();
            blab.setPostDate(item['timestamp']);
            formatter = {
                username: item['username'],
                blab_name: item['blab_name'],
                //content: item['content'],
                timestamp: blab['timestamp'],
                blabid: item['blabid'],
                count: item['commentCount']
            }
            ret += pyformat(template,[],formatter)
        }        
    } catch (ex) {
        console.error(ex);
    }
    return res.send(ret)

}
async function processFeed(req, res){
    blab = req.body['blab']
    nextView = "feed";
    console.log("Entering processBlab");

    username = req.session.username;
    // Ensure user is logged in
    if (username == null) {
        console.log("User is not Logged In - redirecting...");
        return res.redirect("login?target=feed");
    }
    console.log("User is Logged In - continuing... UA=" + req.headers["User-Agent"] + " U=" + username);

    let connect = null;
    let addBlab = null;
    addBlabSql = "INSERT INTO blabs (blabber, content, timestamp) values (?, ?, ?);";

    try {
        console.log("Getting Database connection");
        // Get the Database Connection
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());

        let now = new Date();
        console.log("Preparing the addBlab Prepared Statement");
        addBlab = await connect.prepare(addBlabSql);
        
        //addBlab.setTimestamp(3, new Timestamp(now.getTime()));
        console.log("Executing the addBlab Prepared Statement");
        let addBlabResult = addBlab.execute([username, blab, now]); //Need to implement Timestamps

        // If there is a record...
        if (addBlabResult) {
            // failure
            res.locals['error'] = "Failed to add blab";
        }
        nextView = "feed";
    } catch (ex) {
        console.error(ex);
    } finally {
        try {
            if (addBlab != null) {
                addBlab.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
        try {
            if (connect != null) {
                connect.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
    }

    return res.redirect(nextView);
}

async function showBlab(req,res)
{
    blabid = req.query.blabid;
    nextView = 'res.redirect("feed");';
	console.log("Entering showBlab");

	username = req.session.username;
    // Ensure user is logged in
    if (username == null) {
        console.log("User is not Logged In - redirecting...");
        return res.redirect("login?target=feed");
    }

    console.log("User is Logged In - continuing... UA=" + req.headers["User-Agent"] + " U=" + username);

    let connect = null;
    let blabDetails = null;
    let blabComments = null;
    blabDetailsSql = "SELECT blabs.content, users.blab_name "
            + "FROM blabs INNER JOIN users ON blabs.blabber = users.username " + "WHERE blabs.blabid = ?;";

    blabCommentsSql = "SELECT users.username, users.blab_name, comments.content, comments.timestamp "
            + "FROM comments INNER JOIN users ON comments.blabber = users.username "
            + "WHERE comments.blabid = ? ORDER BY comments.timestamp DESC;";

    try {
        console.log("Getting Database connection");
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());

        // Find the Blabs that this user listens to
        console.log("Preparing the blabDetails Prepared Statement");
        blabDetails = await connect.prepare(blabDetailsSql);
        console.log("Executing the blabDetails Prepared Statement");
        blabDetailsResults = await blabDetails.execute(blabid);

        // If there is a record...
        for (item of blabDetailsResults) {
            // Get the blab contents
            res.locals['content'] = item['content'];
            res.locals['blab_name'] = item['blab_name'];
            res.locals['blabid'] = blabid;
            // Now lets get the comments...
            console.log("Preparing the blabComments Prepared Statement");
            blabComments = await connect.prepare(blabCommentsSql);
            console.log("Executing the blabComments Prepared Statement");
            blabCommentsResults = await blabComments.execute(blabid);

            // Store them in the model
            comments = [];
            for (item of blabCommentsResults) {
                let author = new Blabber();
                author.setUsername(item['username']);
                author.setBlabName(item['blab_name']);

                let comment = new Comment();
                comment.setContent(item['content']);
                comment.setTimestamp(item['timestamp']);
                comment.setAuthor(author);

                comments.push(comment);
            }
            res.locals['comments'] = comments

            nextView = 'res.render("blab");';
        }

    } catch (ex) {
        console.error(ex);
    } finally {
        try {
            if (blabDetails != null) {
                blabDetails.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
        try {
            if (connect != null) {
                connect.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
    }

    return eval(nextView);
}

async function processBlab(req,res)
{
    const comment = req.body.comment;
    const blabid = req.body.blabid;
    nextView = 'res.redirect("feed");';
    console.log("Entering processBlab");

    username = req.session.username;
    // Ensure user is logged in
    if (username == null) {
        console.log("User is not Logged In - redirecting...");
        return res.redirect("login?target=feed");
    }

    console.log("User is Logged In - continuing... UA=" + req.headers["User-Agent"] + " U=" + username);
    let connect = null;
    let addComment = null;
    let addCommentSql = "INSERT INTO comments (blabid, blabber, content, timestamp) values (?, ?, ?, ?);";

    try {
        console.log("Getting Database connection");
        // Get the Database Connection
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());

        const now = new Date();

        //
        console.log("Preparing the addComment Prepared Statement");
        addComment = await connect.prepare(addCommentSql);
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss')

        console.log("Executing the addComment Prepared Statement");
        let addCommentResult = await addComment.execute([blabid,username,comment,timestamp]); //Change null to datetime

        // If there is a record...
        if (addCommentResult) {
            // failure
            res.locals["error"] = "Failed to add comment";
        }

        nextView = 'res.redirect("blab?blabid=' + blabid + '");';
    } catch (ex) {
        console.error(ex);
    } finally {
        try {
            if (addComment != null) {
                addComment.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
        try {
            if (connect != null) {
                connect.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
    }

    return eval(nextView);
    
}

async function showBlabbers(req,res){
    
    let sort = req.query.sort;
    
    if (sort == null || sort.isEmpty()) {
        sort = "blab_name ASC";
    }

    let nextView = 'res.redirect("feed");';
    console.log("Entering showBlabbers");

    const username = req.session.username;
    // Ensure user is logged in
    if (username == null) {
        console.log("User is not Logged In - redirecting...");
        return res.redirect("login?target=blabbers");
    }

    console.log("User is Logged In - continuing... UA=" + req.headers["User-Agent"] + " U=" + username);

    let connect = null;
    let blabberQuery = null;

    /* START EXAMPLE VULNERABILITY */
    const blabbersSql = "SELECT users.username," + " users.blab_name," + " users.created_at,"
            + " SUM(if(listeners.listener=?, 1, 0)) as listeners,"
            + " SUM(if(listeners.status='Active',1,0)) as listening"
            + " FROM users LEFT JOIN listeners ON users.username = listeners.blabber"
            + " WHERE users.username NOT IN (\"admin\",?)" + " GROUP BY users.username" + " ORDER BY " + sort + ";";

    try {
        console.log("Getting Database connection");
        // Get the Database Connection
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());
        // Find the Blabbers
        console.log(blabbersSql);
        blabberQuery = await connect.prepare(blabbersSql);
        let blabbersResults = await blabberQuery.execute([username,username]);
        /* END EXAMPLE VULNERABILITY */

        let blabbers = [];
        for (result of blabbersResults) {
            let blabber = new Blabber();
            blabber.setBlabName(result['blab_name']);
            blabber.setUsername(result['username']);
            blabber.setCreatedDate(result['created_at']);
            blabber.setNumberListeners(result['listeners']);
            blabber.setNumberListening(result['listening']);

            blabbers.push(blabber);
        }
        res.locals["blabbers"] = blabbers;

        nextView = 'res.render("blabbers");';

    } catch (err) {
        console.error(err);
    } finally {
        try {
            if (blabberQuery != null) {
                blabberQuery.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
        try {
            if (connect != null) {
                connect.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
    }

    return eval(nextView);
}

async function processBlabbers(req,res){
    const blabberUsername = req.body.blabberUsername;
    const command = req.body.command;
    let nextView = 'res.redirect("feed");';
    console.log("Entering processBlabbers");

    const username = req.session.username;
    // Ensure user is logged in
    if (username == null) {
        console.log("User is not Logged In - redirecting...");
        return res.redirect("login?target=blabbers");
    }

    console.log("User is Logged In - continuing... UA=" + req.headers["User-Agent"] + " U=" + username);

    if (command == null) {
        console.log("Empty command provided...");
        return nextView = res.redirect("login?target=blabbers");
    }

    console.log("blabberUsername = " + blabberUsername);
    console.log("command = " + command);

    let connect = null;
    let action = null;

    try {
        console.log("Getting Database connection");
        // Get the Database Connection
        connect = await mariadb.createConnection(dbconnector.getConnectionParams());

        /* START EXAMPLE VULNERABILITY */
        let module = String(ucfirst(command)) + "Command";
        const cmdClass = eval(module);
        let cmdObj = new cmdClass(connect, username);
        await cmdObj.execute(blabberUsername);
        /* END EXAMPLE VULNERABILITY */

        nextView = 'res.redirect("blabbers");';

    } catch (err) {
        console.error(err);
    } finally {
        try {
            if (action != null) {
                action.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
        try {
            if (connect != null) {
                connect.close();
            }
        } catch (exceptSql) {
            console.error(exceptSql);
        }
    }
    return eval(nextView);
}

function ucfirst(string)
{
    return string.charAt(0).toUpperCase() + string.slice(1);
}


module.exports = {
    showBlabbers,
    processBlabbers,
    showFeed,
    getMoreFeed,
    processFeed,
    showBlab,
    processBlab,
}