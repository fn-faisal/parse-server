import { ParseMessageQueue }      from '../ParseMessageQueue';
import rest                       from '../rest';
import { applyDeviceTokenExists, getIdRange } from './utils';
import Parse from 'parse/node';
import log from '../logger';
import _ from 'lodash'

const PUSH_CHANNEL = 'parse-server-push';
const DEFAULT_BATCH_SIZE = 100;

export class PushQueue {
  parsePublisher: Object;
  channel: String;
  batchSize: Number;

  // config object of the publisher, right now it only contains the redisURL,
  // but we may extend it later.
  constructor(config: any = {}) {
    this.channel = config.channel || PushQueue.defaultPushChannel();
    this.batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
    this.parsePublisher = ParseMessageQueue.createPublisher(config);
  }

  static defaultPushChannel() {
    return `${Parse.applicationId}-${PUSH_CHANNEL}`;
  }

  enqueue(body, where, config, auth, pushStatus) {
    const limit = this.batchSize;

    where = applyDeviceTokenExists(where);

    // Order by objectId so no impact on the DB
    // const order = 'objectId';
    return Promise.resolve().then(() => {
      return rest.find(config,
        auth,
        '_Installation',
        where,
        {limit: 0, count: true});
    }).then(({results, count}) => {
      if (!results || count == 0) {
        return pushStatus.complete();
      }
      const maxPages = Math.ceil(count / limit)
      pushStatus.setRunning(maxPages);
      let page = 0;
      const promises = [];
      while (page < maxPages) {
        // changes request/limit/orderBy by id range intervals for better performance
        // https://docs.mongodb.com/manual/reference/method/cursor.skip/
        // Range queries can use indexes to avoid scanning unwanted documents,
        // typically yielding better performance as the offset grows compared
        // to using cursor.skip() for pagination.
        const idRange = getIdRange(page, maxPages)
        if (idRange) where.objectId = idRange
        const query = { where };

        const pushWorkItem = {
          body,
          query,
          pushStatus: { objectId: pushStatus.objectId },
          applicationId: config.applicationId
        }
        const publishResult = this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem))
        const promise = Promise.resolve(publishResult).catch(err => err)
        promises.push(promise);
        page ++;
      }
      // if some errors occurs set running to maxPages - errors.length
      return Promise.all(promises).then(results => {
        const errorMessages = results.filter(r => r instanceof Error).map(e => e.message || e);
        const errors = _.countBy(errorMessages) || {};
        if (errorMessages.length > 0) {
          const errorsString = JSON.stringify(errors);
          const packagesSent = maxPages - errorMessages.length;
          if (packagesSent === 0) {
            const errorMessage = `No one push package was sent for PushStatus ${pushStatus.objectId}: ${errorsString}`;
            log.error(errorMessage);
            // throwing error will set status to error
            throw errorMessage;
          } else {
            log.warn(`${packagesSent} packages was sent and some errors happened for PushStatus ${pushStatus.objectId}: ${errorsString}`);
            pushStatus.setRunning(maxPages - errors.length);
          }
        }
      });
    });
  }
}
