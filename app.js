var express = require('express');
var jenkinsapi = require('jenkins-api');
var Slack = require('slack-node');
var app = express();
var bodyParser = require('body-parser');
var parser = require('xml2json');

app.use(bodyParser.json());
var config = require('config');

var slack = new Slack();
slack.setWebhook(config.get('slack_webhook_url'));
var jenkins = jenkinsapi.init('http://' + config.get('jenkins_username') + ':' + config.get('jenkins_token') + '@' + config.get('jenkins_url'));

var slack_username = 'slack-jenkins';
users = {};
valid_commands = [
    'help',
    'search',
    'build',
    'listall',
    'select',
    'info'
];

all_jobs = {};

jenkins.all_jobs(function (err, data) {
    if (err) {
        return console.log(err);
    }
    all_jobs = data;
    for (c in all_jobs){
        jenkins.get_config_xml(all_jobs[c].name, function(err, data) {
            if (err){ return console.log(err); }
            var json = parser.toJson(data, {object: true});
            if (json['maven2-moduleset']
                && json['maven2-moduleset']['scm']
                && json['maven2-moduleset']['scm']['userRemoteConfigs']
                && json['maven2-moduleset']['scm']['userRemoteConfigs']['hudson.plugins.git.UserRemoteConfig']){
                all_jobs[c].gitRepo = json['maven2-moduleset']['scm']['userRemoteConfigs']['hudson.plugins.git.UserRemoteConfig']['url'];
                console.log("job name:", all_jobs[c].name)
                console.log("git repo :", all_jobs[c].gitRepo)
            }
        });
    }
});

function handle_commands(body) {

    command_str = body.text;
    if (!command_str.trim()) {
        post_slack('Hi <@' + body.user_name + '>, please use help to see all available commands');
        return;
    }
    commands = command_str.split(' ');
    switch (commands[0]) {
        case 'help':
            msg = 'Here are all available commands:';
            for (c in valid_commands) {
                console.log(c);
                msg = msg + '\n\t' + c + ': `' + valid_commands[c] + '`'
            }
            post_slack(msg);
            break;
        case 'search':
            if (commands.length > 1) {
                msg = 'Found matching jobs:';
                for (c in all_jobs) {
                    var job = all_jobs[c];
                    if (job.name.indexOf(commands[1]) > -1) {
                        msg = msg + '\n\t' + c + ' - <' + job.url + '|' + job.name + '>'
                    }
                }
                msg = msg + '\nPlease select job';
                post_slack(msg);
            } else {
                post_slack('You have to specify a search query');
            }
            break;
        case 'build':
            if (get_job(body.user_id)) {
                if (commands.length > 1) {
                    jenkins.build(get_job(body.user_id).name, {key: 'value'}, function (err, data) {
                        if (err) {
                            return console.log(err);
                        }
                        console.log(data);
                    });
                } else {
                    jenkins.build(get_job(body.user_id).name, function (err, data) {
                        if (err) {
                            return console.log(err);
                        }
                        console.log(data);
                    });
                }
            } else {
                post_slack('You have to specify a job name');
            }
            break;
        case 'info':
            if (get_job(body.user_id)) {
                jenkins.job_info(get_job(body.user_id).name, function (err, data) {
                    if (err) {
                        return console.log(err);
                    }
                    for (c in data.property) {
                        if (data.property[c] != undefined) {
                            if (data.property[c]['parameterDefinitions']) {
                                prop = data.property[c]['parameterDefinitions'];
                                users[body.user_id]['selected_job']['properties'] = [];
                                for (p in prop) {
                                    users[body.user_id]['selected_job']['properties'].push(prop[p]['name']);
                                }
                            }
                        }
                    }
                });
            } else {
                post_slack('You have to specify a job name');
            }
            break;
        case 'listall':
            msg = 'Here are all available commands:';
            for (c in all_jobs) {
                var job = all_jobs[c];
                msg = msg + '\n\t' + c + ' - <' + job.url + '|' + job.name + '>'
            }
            msg = msg + '\nPlease select job';
            post_slack(msg);
            break;
        case 'select':
            if (commands.length > 1) {
                console.log('commands, ', commands);
                users[body.user_id] = {};
                users[body.user_id]['selected_job'] = all_jobs[commands[1]];
                console.log(users[body.user_id]['selected_job']);
                msg = 'Selected job :`' + users[body.user_id]['selected_job'].name + '`';
                post_slack(msg);
            } else {
                post_slack('No job number specified');
            }
        default:
            break;
    }
}

function get_job(user_id) {
    if (users[user_id] && users[user_id]['selected_job']) {
        return users[user_id]['selected_job'];
    }
    return undefined;
}

function post_slack(message) {
    var channel = '#myself';
    slack.webhook({
        channel: channel,
        username: slack_username,
        text: message,
        mrkdwn: true
    }, function (err, response) {
        console.log(response);
    });
}

app.listen(3000, function () {
    console.log('Example app listening on port 3000!');
});

app.get('/', function (req, res) {
    res.send('Hello World!');
});

// POST method route
app.post('/', function (req, res) {
    // console.log("req.body", req.body)
    // console.log("req.body", req.body)
    if (req.body.token = config.get('slack_token')) {
        handle_commands(req.body);
        res.send('Ok');
    } else {
        res.status(401);
        res.send('Unauthorized');
    }
});
