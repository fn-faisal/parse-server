import redis from 'redis';
import Parse from 'parse/node';

function createPublisher({redisURL}): any {
  var redisCli = redis.createClient(redisURL, { no_ready_check: true });

  if (redisCli) {
    redisCli.publish2 = redisCli.publish;

    redisCli.publish = function (channel, body) {
      var bodyObject;
      try {
        bodyObject = JSON.parse(body);
      } catch (e) {
        bodyObject = {};
      }
      if (bodyObject && bodyObject.pushStatus) {
        redisCli.multi([
          ['sadd', bodyObject.applicationId + ':push', body]
        ]).exec();
      }
      return redisCli.publish2(channel, body);
    };
  }

  return redisCli;
}

function createSubscriber({redisURL}): any {
  var redisCli = redis.createClient(redisURL, { no_ready_check: true });
  var secondaryClient = redis.createClient(redisURL, { no_ready_check: true });
  if (redisCli) {
    redisCli.run = function (workItem) {
      return new Parse.Promise(function (resolve) {
        secondaryClient
          .multi([
            ['spop', workItem.applicationId + ':push']
          ])
          .exec(function (err, rep) {
            if (!err && rep && rep[0]) {
              resolve(JSON.parse(rep[0]));
            } else {
              resolve();
            }
          })
      });
    };
  }

  return redisCli;
}

const RedisPubSub = {
  createPublisher,
  createSubscriber
};

export {
  RedisPubSub,
  createPublisher,
  createSubscriber
}
