var express = require('express');
var jenkinsapi = require('jenkins-api');
var Slack = require('slack-node');
var app = express();
var bodyParser = require('body-parser');
var parser = require('xml2json');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

var config = require('config');
var GitHubApi = require("github");

var github = new GitHubApi();

github.authenticate({
    type: "oauth",
    token: config.get('git_token')
});

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
    'select'
];

var all_jobs = {};

jenkins.all_jobs(function (err, data) {
    console.log("all_jobs");
    if (err) {
        return console.log('error; ', err);
    }
    all_jobs = data;
});

function handle_commands(body) {

    var command_str = body.text;
    if (!command_str.trim()) {
        post_slack('', [
            {
                'pretext': 'Hi <@' + body.user_name + '>, please use help to see all available commands',
                "text": "Please responding with ```/jenkins help```",
                'color': 'warning',
                "mrkdwn_in": [
                    "text",
                    "pretext"
                ]
            }
        ]);
        return;
    }
    var commands = command_str.split(' ');
    switch (commands[0]) {
        case 'help':
            var msg = '';
            for (c in valid_commands) {
                msg = msg + '- ' + valid_commands[c] + '\n';
            }
            post_slack('', [
                {
                    "pretext": "Here are all available commands",
                    "text": msg,
                    "mrkdwn_in": [
                        "text",
                        "pretext"
                    ]
                }
            ]);
            break;
        case 'search':
            if (commands.length > 1) {
                var msg = '';
                for (var c in all_jobs) {
                    var job = all_jobs[c];
                    if (job.name.indexOf(commands[1]) > -1) {
                        msg = msg + c + '. - <' + job.url + '|' + job.name + '>\n'
                    }
                }
                post_slack('', [
                    {
                        "pretext": "Found matching jobs",
                        "text": msg,
                        'color': 'good',
                        "mrkdwn_in": [
                            "text",
                            "pretext"
                        ]
                    },
                    {
                        "pretext": "Please select a job by responding with ```/jenkins select [number]```",
                        "mrkdwn_in": [
                            "text",
                            "pretext"
                        ]
                    }
                ]);
            } else {
                post_slack('', [
                    {
                        'text': 'You have to specify a search query with ```/jenkins search [name]```',
                        'color': 'danger'
                    }
                ]);
            }
            break;
        case 'listall':
            var msg = '';
            for (c in all_jobs) {
                var job = all_jobs[c];
                msg = msg + c + '. - <' + job.url + '|' + job.name + '>\n'
            }
            post_slack('', [
                {
                    "pretext": "Here are all available jobs on build server",
                    "text": msg,
                    'color': 'good',
                    "mrkdwn_in": [
                        "text",
                        "pretext"
                    ]
                },
                {
                    "pretext": "Please select a job by responding with ```/jenkins select [number]```",
                    "mrkdwn_in": [
                        "text",
                        "pretext"
                    ]
                }
            ]);
            break;
        case 'select':
            if (commands.length > 1) {
                users[body.user_id] = {};
                users[body.user_id]['selected_job'] = all_jobs[commands[1]];
                console.log(users[body.user_id]['selected_job']);
                post_slack('', [
                    {
                        "pretext": "You have selected job",
                        "text": '*' + users[body.user_id]['selected_job'].name + '*',
                        'color': 'good',
                        "mrkdwn_in": [
                            "text",
                            "pretext"
                        ]
                    }
                ]);

                jenkins.job_info(get_job(body.user_id).name, function (err, data) {
                    if (err) {
                        return console.log(err);
                    }
                    for (c in data.property) {
                        if (data.property[c] != undefined && data.property[c]['parameterDefinitions']) {
                            var prop = data.property[c]['parameterDefinitions'];
                            console.log('prop, ', prop);
                            users[body.user_id]['selected_job']['properties'] = [];
                            users[body.user_id]['selected_job']['git_branches'] = [];
                            users[body.user_id]['selected_job'].github = false;
                            for (var p in prop) {
                                if (prop[p]['type'] == 'StringParameterDefinition') {
                                    users[body.user_id]['selected_job']['properties'].push(prop[p]['name']);

                                } else if (prop[p]['type'] == 'PT_BRANCH') {
                                    users[body.user_id]['selected_job'].github = true;
                                }
                            }

                            if (users[body.user_id]['selected_job'].github) {
                                jenkins.get_config_xml(users[body.user_id]['selected_job'].name, function (err, data) {
                                    if (err) {
                                        return console.log(err);
                                    }
                                    var json = parser.toJson(data, {object: true});
                                    if (json['maven2-moduleset']
                                        && json['maven2-moduleset']['scm']
                                        && json['maven2-moduleset']['scm']['userRemoteConfigs']
                                        && json['maven2-moduleset']['scm']['userRemoteConfigs']['hudson.plugins.git.UserRemoteConfig']) {
                                        users[body.user_id]['selected_job'].gitRepo = json['maven2-moduleset']['scm']['userRemoteConfigs']['hudson.plugins.git.UserRemoteConfig']['url'];
                                    } else if (json['project']
                                        && json['project']['scm']
                                        && json['project']['scm']['userRemoteConfigs']
                                        && json['project']['scm']['userRemoteConfigs']['hudson.plugins.git.UserRemoteConfig']) {
                                        users[body.user_id]['selected_job'].gitRepo = json['project']['scm']['userRemoteConfigs']['hudson.plugins.git.UserRemoteConfig']['url'];
                                    }
                                    if (users[body.user_id]['selected_job'].gitRepo){
                                        var repoName = users[body.user_id]['selected_job'].gitRepo.split('/')[1];
                                        repoName = repoName.split('.git')[0];
                                        github.repos.getBranches({
                                            user:'qapital',
                                            repo: repoName
                                        }, function(err, res) {
                                            var msg = '';
                                            for (var b in res){
                                                if (res[b].name != undefined){
                                                    users[body.user_id]['selected_job']['git_branches'].push(res[b].name);
                                                    msg = msg + '- ' + res[b].name + '\n';
                                                }
                                            }
                                            post_slack("This job depends on custom build parameters", [
                                                {
                                                    "text": "To build selected job please use ```/jenkins build " + prop[p]['name'] + "=selectedBranch```",
                                                    'color': 'warning',
                                                    "mrkdwn_in": [
                                                        "text",
                                                        "pretext"
                                                    ]
                                                },
                                                {
                                                    "pretext": "Available branches to build:",
                                                    "text": msg,
                                                    'color': 'warning',
                                                    "mrkdwn_in": [
                                                        "text",
                                                        "pretext"
                                                    ]
                                                }
                                            ]);
                                        });
                                    }else{
                                        post_slack('', [
                                            {
                                                'text': 'Can\' find github repo inside jenkins configuration',
                                                'color': 'danger'
                                            }
                                        ]);
                                    }
                                });
                            } else {
                                post_slack("This job depends on custom build parameters", [
                                    {
                                        "text": "To build selected job please use ```/jenkins build " + prop[p]['name'] + "=value```",
                                        'color': 'warning',
                                        "mrkdwn_in": [
                                            "text",
                                            "pretext"
                                        ]
                                    }
                                ]);

                            }
                        }
                    }
                });
            } else {
                post_slack('', [
                    {
                        'text': 'No job number specified',
                        'color': 'danger'
                    }
                ]);
            }
            break;
        case 'build':
            if (get_job(body.user_id)) {
                if (commands.length > 1) {
                    var parms = {};
                    var params = commands[1].split('=');
                    parms[params[0]] = params[1];
                    console.log('params, ', params);
                    console.log('parms, ', parms);

                    jenkins.build(get_job(body.user_id).name, parms, function (err, data) {
                        if (err) {
                            return console.log(err);
                        }
                        console.log(data);
                        post_slack("", [
                            {
                                "pretext": "Build started successfully",
                                "text": '*' + users[body.user_id]['selected_job'].name + '*',
                                'color': 'good',
                                "mrkdwn_in": [
                                    "text",
                                    "pretext"
                                ]
                            }
                        ]);
                    });
                } else {
                    jenkins.build(get_job(body.user_id).name, function (err, data) {
                        if (err) {
                            return console.log(err);
                        }
                        post_slack("", [
                            {
                                "pretext": "Build started successfully",
                                "text": '*' + users[body.user_id]['selected_job'].name + '*',
                                'color': 'good',
                                "mrkdwn_in": [
                                    "text",
                                    "pretext"
                                ]
                            }
                        ]);
                        console.log(data);
                    });
                }
            } else {
                post_slack('', [
                    {
                        'text': 'You have to specify a job name',
                        'color': 'warning'
                    }
                ]);
            }
            break;

        default:
            post_slack('', [
                {
                    'text': 'Hi <@' + body.user_name + '>, please use help to see all available commands',
                    'color': 'warning'
                }
            ]);
            break;
    }
}

function get_job(user_id) {
    if (users[user_id] && users[user_id]['selected_job']) {
        return users[user_id]['selected_job'];
    }
    return undefined;
}

function post_slack(text, attachments, channel, username) {
    if (typeof channel === 'undefined') {
        channel = '#myself';
    }
    if (typeof username === 'undefined') {
        username = slack_username;
    }
    slack.webhook({
        channel: channel,
        username: username,
        text: text,
        attachments: attachments
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
    console.log("req.body", req.body);
    if (req.body.token = config.get('slack_token')) {
        post_slack('', [
            {
                "pretext": "`/jenkins " + req.body.text + "`",
                "mrkdwn_in": [
                    "text",
                    "pretext"
                ]
            }
        ], undefined, req.body.username);

        handle_commands(req.body);
        res.send();

    } else {
        res.status(401);
        res.send('Unauthorized');
    }
});
