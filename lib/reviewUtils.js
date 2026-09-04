'use strict';

/**
 * Review payload post-processing shared by the REST route
 * (GET /apps/:appId/reviews) and the GraphQL reviews() resolver.
 *
 * Privacy rules:
 * - userdata=false strips reviewer identity (userName/userImage/_url)
 * - replies=false strips developer replies; replies=true redacts the
 *   reviewer's name from the developer's reply text
 * - date is always trimmed to YYYY-MM-DD
 * - an exhausted pagination arrives as null and is normalized to ''
 */

const sanitizeReplyText = (text, userName) => {
  const userNameParts = userName.split(' ');

  function escapeRegExp (string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const userNamePatterns = userNameParts.map(part => new RegExp(escapeRegExp(part), 'gi'));

  return userNamePatterns.reduce(
    (sanitizedText, pattern) => sanitizedText.replace(pattern, '[REDACTED_USER]'),
    text
  );
};

export function processReviews (reviews, includeUserData, includeReplies) {
  if (!includeUserData) {
    reviews.data = reviews.data.map(review => {
      const { userName, userImage: _userImage, replyText, _url, ...rest } = review;
      rest.date = rest.date.split('T')[0];
      if (!includeReplies) {
        delete rest.replyText;
        delete rest.replyDate;
      } else if (includeReplies && replyText) {
        const sanitizedReplyText = sanitizeReplyText(replyText, userName);
        rest.replyText = sanitizedReplyText;
      }
      return rest;
    });
  } else {
    if (!includeReplies) {
      reviews.data = reviews.data.map(review => {
        const { _replyText, _replyDate, _url, ...rest } = review;
        rest.date = rest.date.split('T')[0];
        return rest;
      });
    } else {
      reviews.data = reviews.data.map(review => {
        const { _url, ...rest } = review;
        rest.date = rest.date.split('T')[0];
        return rest;
      });
    }
  }
  if (reviews.nextPaginationToken === null) reviews.nextPaginationToken = '';
  return reviews;
}
