/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is DownThemAll! Decompressor module.
 *
 * The Initial Developer of the Original Code is Nils Maier
 * Portions created by the Initial Developer are Copyright (C) 2007-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *	 Nils Maier <MaierMan@web.de>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */
 
const EXPORTED_SYMBOLS = ['setAuthPrompterWindow', 'Connection', 'GlobalBucket'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;
const Ctor = Components.Constructor;
const module = Cu.import;
const Exception = Components.Exception;

const NS_ERROR_MODULE_NETWORK = 0x804B0000;
const NS_ERROR_BINDING_ABORTED = NS_ERROR_MODULE_NETWORK + 2;
const NS_ERROR_UNKNOWN_HOST = NS_ERROR_MODULE_NETWORK + 30;
const NS_ERROR_CONNECTION_REFUSED = NS_ERROR_MODULE_NETWORK + 13;
const NS_ERROR_NET_TIMEOUT = NS_ERROR_MODULE_NETWORK + 14;
const NS_ERROR_NET_RESET = NS_ERROR_MODULE_NETWORK + 20;
const NS_ERROR_FTP_CWD = NS_ERROR_MODULE_NETWORK + 22;

let DTA = {}, RequestManipulation = {};
module("resource://gre/modules/XPCOMUtils.jsm");

module('resource://dta/api.jsm', DTA);
module('resource://dta/constants.jsm');
module('resource://dta/utils.jsm');
module('resource://dta/manager/requestmanipulation.jsm', RequestManipulation);
module('resource://dta/support/bytebucket.jsm');

const Preferences = DTA.Preferences;
const Debug = DTA.Debug;

extendString(String);

ServiceGetter(this, "IOService", "@mozilla.org/network/io-service;1", "nsIIOService2");

(function() {
	let strings = {};
	for (let s in new SimpleIterator(Cc["@mozilla.org/intl/stringbundle;1"]
		.getService(Ci.nsIStringBundleService)
		.createBundle('chrome://dta/locale/manager.properties')
		.getSimpleEnumeration(), Ci.nsIPropertyElement)) {
		strings[s.key] = s.value;
	}
	let bundles = new StringBundles(strings);
	this['_'] = function() (arguments.length == 1) ? bundles.getString(arguments[0]) : bundles.getFormattedString.apply(bundles, arguments);
})();


let _window = null;
let _m = this;
function setAuthPrompterWindow(_wnd) {
	_window = _wnd;
	delete _m.AuthPrompts;
	setNewGetter(_m, 'AuthPrompts', function() {
			let _l = {};
			module('resource://dta/support/loggedprompter.jsm', _l);
			return new _l.LoggedPrompter(_window);
		}
	);
}

function Connection(d, c, isInfoGetter) {

	this.d = d;
	this.c = c;
	this.isInfoGetter = isInfoGetter;
	this.url = d.urlManager.getURL();
	
	let url = this.url.url;
	RequestManipulation.modifyURL(url);
	
	let referrer = d.referrer;
	Debug.logString("starting: " + url.spec);

	this._chan = IOService.newChannelFromURI(url);
	let r = Ci.nsIRequest;
	let loadFlags = r.LOAD_NORMAL
	if (!Preferences.getExt('useCache', false)) {
		loadFlags = loadFlags | r.LOAD_BYPASS_CACHE;
	}
	else {
		Debug.logString("using cache");
	}
	this._chan.loadFlags = loadFlags;
	this._chan.notificationCallbacks = this;
	try {
		let encodedChannel = this._chan.QueryInterface(Ci.nsIEncodedChannel);
		encodedChannel.applyConversion = false;
	}
	catch (ex) {
		// no-op
	}
	if (this._chan instanceof Ci.nsIHttpChannel) {
		try {
			Debug.logString("http");
			let http = this._chan.QueryInterface(Ci.nsIHttpChannel);
			
			if (c.start + c.written > 0) {
				http.setRequestHeader('Range', 'bytes=' + (c.start + c.written) + "-", false);
			}

			// Cannot hash when compressed
			http.setRequestHeader("Accept-Encoding", "", false);

			if (this.isInfoGetter) {
				if (!d.fromMetalink) {
					http.setRequestHeader('Accept', 'application/metalink4+xml;q=0.9,application/metalink+xml;q=0.8', true);
				}
				http.setRequestHeader('Want-Digest', DTA.WANT_DIGEST_STRING, false);
			}
			
			if (referrer instanceof Ci.nsIURI) {
				http.referrer = referrer;
			}
			if (Preferences.getExt('nokeepalive', true)) {
				http.setRequestHeader('Keep-Alive', '', false);
				http.setRequestHeader('Connection', 'close', false);
			}
			if (d.postData) {
				let uc = http.QueryInterface(Ci.nsIUploadChannel);
				uc.setUploadStream(new StringInputStream(d.postData, d.postData.length), null, -1);
				http.requestMethod = 'POST';
			}			 

			RequestManipulation.modifyHttp(http);
		}
		catch (ex) {
			Debug.log("error setting up http channel", ex);
			// no-op
		}
	}
	else if (this._chan instanceof Ci.nsIFTPChannel) {
		try {
			let ftp = this._chan.QueryInterface(Ci.nsIFTPChannel);
			if (c.start + c.written > 0) {
					let resumable = ftp.QueryInterface(Ci.nsIResumableChannel);
					resumable.resumeAt(c.start + c.written, '');
			}				
		}
		catch (ex) {
			Debug.log('error setting up ftp channel', ex);
		}
	}
	try {
		let prio = this._chan.QueryInterface(Ci.nsISupportsPriority);
		prio.adjustPriority(Ci.nsISupportsPriority.PRIORITY_LOW);
	}
	catch (ex) {
		Debug.log("Failed setting priority", ex);
	}
	this.c.running = true;
	this._chan.asyncOpen(this, null);
	Debug.logString(this.c + "is now open");
}

Connection.prototype = {
	_interfaces: [
		Ci.nsIInterfaceRequestor,
		Ci.nsIStreamListener,
		Ci.nsIRequestObserver,
		Ci.nsIProgressEventSink,
		Ci.nsIChannelEventSink,
		Ci.nsIFTPEventSink,
		Ci.nsISupports,
		Ci.nsISupportsWeakReference,
		Ci.nsIWeakReference,
		Ci.nsIClassInfo,
		Ci.nsICancelable,
	],
		
	cantCount: false,

	QueryInterface: function DL_QI(iid) {
		for each (let i in this._interfaces) {
			if (iid.equals(i)) {
				return this;
			}
		}
		throw Cr.NS_ERROR_NO_INTERFACE;
	},
	// nsISupportsWeakReference
	GetWeakReference: function DL_GWR() this,
	// nsIWeakReference
	QueryReferent: function DL_QR(uuid) this.QueryInterface(uuid),

	// nsICancelable
	cancel: function DL_cancel(aReason) {
		try {
			if (this._closed) {
				return;
			}
			Debug.logString("cancel");
			if (!aReason) {
				aReason = NS_ERROR_BINDING_ABORTED;
			}
			this._chan.cancel(aReason);
			this._closed = true;
		}
		catch (ex) {
			Debug.log("cancel", ex);
		}
	},
	// nsIInterfaceRequestor
	getInterface: function DL_getInterface(iid) {
		if (iid.equals(Ci.nsIAuthPrompt)) {
			return AuthPrompts.authPrompter;
		}
		if (iid.equals(Ci.nsIPrompt)) {
			return AuthPrompts.prompter;
		}
		if ('nsIAuthPrompt2' in Ci && iid.equals(Ci.nsIAuthPrompt2)) {
			return AuthPrompts.authPrompter.QueryInterface(Ci.nsIAuthPrompt2);
		}
		return this.QueryInterface(iid);
	},
	
	// nsIClassInfo
	getInterfaces: function(aCount) {
		aCount.value = this._interfaces.length;
		return this._interfaces;
	},

	getHelperForLanguage: function(aLanguage) null,
	contractID: null,
	classDescription: "DownThemAll! connection",
	classID: null,
	implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
	flags: Ci.nsIClassInfo.MAIN_THREAD_ONLY,
	
	// nsIChannelEventSink
	asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback) {
		this.onChannelRedirect(oldChannel, newChannel, flags);
		callback.onRedirectVerifyCallback(0);
	},
	onChannelRedirect: function DL_onChannelRedirect(oldChannel, newChannel, flags) {
		let c = this.c;
		try {
			if (!(oldChannel instanceof Ci.nsIChannel) || !(newChannel instanceof Ci.nsIChannel)) {
				throw new Exception("redirect: requests not channels");
			}
			
			if (newChannel instanceof Ci.nsIHttpChannel) {
				RequestManipulation.modifyHttp(newChannel);
			}
			
			// When we get redirected from, say, http to ftp, we need to explicitly
			// call resumeAt() as this won't be propagated from the old channel.
			if (c.start + c.written > 0 && !(newChannel instanceof Ci.nsIHttpChannel)) {
				let resumable = newChannel.QueryInterface(Ci.nsIResumableChannel);
				resumable.resumeAt(c.start + c.written, '');
				Debug.logString("redirect: set resumeAt on " + newChannel.URI.spec + "/" + newChannel.originalURI.spec + " at " + (c.start + c.written));
			}
		}
		catch (ex) {
			Debug.log("redirect: cannot resumeAt", ex);
			if (!this.handleError()) {
				d.fail(_('servererror'), _('ftperrortext'), _('servererror'));
				return;
			}
		}
			
		this._chan = newChannel;
		
		if (!this.isInfoGetter) {
			return;
		}
		try {
			let newurl = new DTA.URL(newChannel.URI.QueryInterface(Ci.nsIURL), this.url.preference);
			this.d.urlManager.replace(this.url, newurl);
			this.url = newurl;
			this.d.fileName = this.url.usable.getUsableFileName();
		}
		catch (ex) {
			Debug.log("Failed to reset data on channel redirect", ex);
		}
	},
	
	// nsIStreamListener
	onDataAvailable: function DL_onDataAvailable(aRequest, aContext, aInputStream, aOffset, aCount) {
		if (this._closed) {
			throw NS_ERROR_BINDING_ABORTED;
		}
		try {
			// we want to kill ftp chans as well which do not seem to respond to
			// cancel correctly.
			if (0 > this.c.write(aRequest, aInputStream, aCount)) {
				// we already got what we wanted
				this.cancel();
			}
		}
		catch (ex) {
			Debug.log('onDataAvailable', ex);
			this.d.fail(_("accesserror"), _("permissions") + " " + _("destpath") + ". " + _("checkperm"), _("accesserror"));
		}
	},
	
	// nsIFTPEventSink
	OnFTPControlLog: function(server, msg) {
		/*
		 * Very hacky :p If we don't handle it here, then nsIFTPChannel will + try
		 * to CWD to the file (d'oh) + afterwards ALERT (modally) that the CWD
		 * didn't succeed (double-d'oh)
		 */
		if (!server) {
			this._wasRetr = /^RETR/.test(msg) || /^REST/.test(msg);
		}
	},
	
	handleError: function DL_handleError() {
		let c = this.c;
		let d = this.d;
		
		c.cancel();
		d.dumpScoreboard();
		if (d.chunks.indexOf(c) == -1) {
			// already killed;
			return true;
		}

		Debug.logString("handleError: problem found; trying to recover");
		
		if (d.urlManager.markBad(this.url)) {
			Debug.logString("handleError: fresh urls available, kill this one and use another!");
			d.timeLastProgress = getTimestamp();
			return true;
		}
		
		Debug.logString("affected: " + c);
		d.dumpScoreboard();
		
		let max = -1, found = null;
		for each (let cmp in d.chunks) {
			if (!cmp.running) {
				continue;
			}
			if (cmp.start < c.start && cmp.start > max) {
				found = cmp;
				max = cmp.start;
			}
		}
		if (found) {
			Debug.logString("handleError: found joinable chunk; recovering suceeded, chunk: " + found);
			found.end = c.end;
			if (--d.maxChunks == 1) {
				// d.resumable = false;
			}
			d.chunks = d.chunks.filter(function(ch) ch != c);
			d.chunks.sort(function(a, b) a.start - b.start);
			
			// check for overlapping ranges we might have created
			// otherwise we'll receive a size mismatch
			// this means that we're gonna redownload an already finished chunk...
			for (let i = d.chunks.length - 2; i > -1; --i) {
				let c1 = d.chunks[i], c2 = d.chunks[i + 1];
				if (c1.end >= c2.end) {
					if (c2.running) {
						// should never ever happen :p
						d.dumpScoreboard();
						Debug.logString("overlapping:\n" + c1 + "\n" + c2);
						d.fail("Internal error", "Please notify the developers that there were 'overlapping chunks'!", "Internal error (please report)");
						return false;
					}
					d.chunks.splice(i + 1, 1);
				}
			}
			let ac = 0;
			d.chunks.forEach(function(c) { if (c.running) { ++ac;	}});
			d.activeChunks = ac;
			c.close();
			
			d.save();
			d.dumpScoreboard();
			return true;
		}
		Debug.logString("recovery failed");
		return false;
	},
	handleHttp: function DL_handleHttp(aChannel) {
		let c = this.c;
		let d = this.d;
		
		let code = 0, status = 'Server returned nothing';
		try {
			code = aChannel.responseStatus;
			status = aChannel.responseStatusText;
		}
		catch (ex) {
			return true;
		}
		 
		if (code >= 400) {
			// any data that we got over this channel should be considered "corrupt"
			c.rollback();
			
			if (c.starter && d.urlManager.markBad(this.url)) {
				Debug.log("caught bad server (Error: " + code + ")", d.toString());
				d.cancel();
				d.safeRetry();
				return false;
			}
			if (!this.handleError()) {
				Debug.log("handleError: Cannot recover from problem!", code);
				if ([401, 402, 407, 500, 502, 503, 504].indexOf(code) != -1 || Preferences.getExt('recoverallhttperrors', false)) {
					Debug.log("we got temp failure!", code);
					d.pauseAndRetry();
					d.status = code >= 500 ? _('temperror') : _('autherror');
				}
				else if (code == 450) {
					d.fail(
						_('pcerrortitle'),
						_('pcerrortext'),
						_('pcerrortitle')
					);
				}
				else {
					var file = d.fileName.length > 50 ? d.fileName.substring(0, 50) + "..." : d.fileName;
					code = formatNumber(code, 3);
					if (Preferences.getExt('resumeonerror', false)) {
						d.pauseAndRetry();
						d.status = _('temperror');
					}
					else {
						d.fail(
							_("error", [code]),
							_("failed", [file]) + " " + _("sra", [code]) + ": " + status,
							_("error", [code])
						);
					}
				}
				d.save();
			}
			return false;
		}

		// not partial content altough we are multi-chunk
		if (code != 206 && !this.isInfoGetter) {
			Debug.log(d + ": Server returned a " + aChannel.responseStatus + " response instead of 206", this.isInfoGetter);
			
			if (!this.handleError()) {
				vis = {value: '', visitHeader: function(a,b) { this.value += a + ': ' + b + "\n"; }};
				aChannel.visitRequestHeaders(vis);
				Debug.logString("Request Headers\n\n" + vis.value);
				vis.value = '';
				aChannel.visitResponseHeaders(vis);
				Debug.logString("Response Headers\n\n" + vis.value);
				d.cancel();
				d.resumable = false;
				d.safeRetry();
				return false;
			}
		}

		var visitor = null;
		try {
			visitor = d.visitors.visit(aChannel);
		}
		catch (ex) {
			Debug.log("header failed! " + d, ex);
			// restart download from the beginning
			d.cancel();
			d.resumable = false;
			d.safeRetry();
			return false;
		}
		
		if (!this.isInfoGetter) {
			return false;
		}

		if (visitor.type) {
			d.contentType = visitor.type;
		}

		// compression?
		if (['gzip', 'deflate'].indexOf(visitor.encoding) != -1 && !d.contentType.match(/gzip/i) && !d.fileName.match(/\.gz$/i)) {
			d.compression = visitor.encoding;
		}
		else {
			d.compression = null;
		}
		
		if (visitor.hash && (!d.hashCollection || !d.hashCollection.full || d.hashCollection.full.q < visitor.hash.q)) {
			d.hashCollection = new DTA.HashCollection(visitor.hash);
		}

		// accept range
		d.resumable &= visitor.acceptRanges;

		if (visitor.type && visitor.type.search(/application\/metalink4?\+xml/) != -1) {
			d.isMetalink = true;
			d.resumable = false;
		}

		if (visitor.contentLength > 0) {
			d.totalSize = visitor.contentLength;
		}
		else {
			d.totalSize = 0;
		}
		
		if (visitor.fileName && visitor.fileName.length > 0) {
			// if content disposition hasn't an extension we use extension of URL
			let newName = visitor.fileName.getUsableFileName();
			let ext = this.url.usable.getExtension();
			if (visitor.fileName.lastIndexOf('.') == -1 && ext) {
				newName += '.' + ext;
			}
			d.fileName = newName.getUsableFileName();
		}

		return false;
	},
	
	// Generic handler for now :p
	handleFtp: function  DL_handleFtp(aChannel) {
		let c = this.c;
		let d = this.d;
		try {
			let totalSize = 0;
			try {
				let pb = aChannel.QueryInterface(Ci.nsIPropertyBag2);
				totalSize = Math.max(pb.getPropertyAsInt64('content-length'), 0);
			}
			catch (ex) {
				// Firefox 4 support 64bit contentLength
				totalSize = Math.max(aChannel.contentLength, 0); 
			}
			if (d.totalSize && totalSize != this.totalSize && !this.handleError()) {
				Debug.logString("ftp: total size mismatch " + totalSize + " " + this.totalSize);
				d.fail(_('servererror'), _('ftperrortext'), _('servererror')); 
				return false;
			}
			Debug.logString("ftp: total size is: " + totalSize + " for: " + this.url);
			d.totalSize = totalSize;
		}
		catch (ex) {
			Debug.log("ftp: no totalsize", ex);
			if (c.start != 0 && !this.handleError()) {
				d.fail(_('servererror'), _('ftperrortext'), _('servererror')); 
				return false;
			}
			d.totalSize = 0;
			d.resumable = false;
		}
		
		try {
			aChannel.QueryInterface(Ci.nsIResumableChannel).entityID;
		}
		catch (ex) {
			Debug.logString("likely not resumable or connection refused!");
			if (!this.handleError()) {
				// restart download from the beginning
				d.fail(_('servererror'), _('ftperrortext'), _('servererror')); 
				return false;
			}
		}
		
		try {
			let visitor = d.visitors.visit(aChannel.QueryInterface(Ci.nsIChannel));
		}
		catch (ex) {
			Debug.log("header failed! " + d, ex);
			// restart download from the beginning
			d.cancel();
			d.resumable = false;
			d.safeRetry();
			return false;
		}
		return false;
	},
	
	handleGeneric: function DL_handleGeneric(aChannel) {
		var c = this.c;
		var d = this.d;
		
		// hack: determine if we are a multi-part chunk,
		// if so something bad happened, 'cause we aren't supposed to be multi-part
		if (c.start != 0 && d.is(RUNNING)) {
			if (!this.handleError()) {
				Debug.log(d + ": Server error or disconnection", "(type 1)");
				d.pauseAndRetry();
				d.status = _("servererror");
			}
			return false;
		}			
			
		// try to get the size anyway ;)
		try {
			let pb = aChannel.QueryInterface(Ci.nsIPropertyBag2);
			d.totalSize = Math.max(pb.getPropertyAsInt64('content-length'), 0);
		}
		catch (ex) {
			try {
				d.totalSize = Math.max(aChannel.contentLength, 0);
			}
			catch (ex) {
				d.totalSize = 0;
			}
		}
		d.resumable = false;
		return false;
	},
	
	// nsIRequestObserver,
	_supportedChannels: [
		{i:Ci.nsIHttpChannel, f:'handleHttp'},
		{i:Ci.nsIFTPChannel, f:'handleFtp'},
		{i:Ci.nsIChannel, f:'handleGeneric'}
	],
	onStartRequest: function DL_onStartRequest(aRequest, aContext) {
		let c = this.c;
		let d = this.d;
		Debug.logString('StartRequest: ' + c);
	
		this.started = true;
		try {
			for each (let sc in this._supportedChannels) {
				let chan = null;
				try {
					chan = aRequest.QueryInterface(sc.i);
					if ((this.rexamine = this[sc.f](chan))) {
						 return;
					}
					break;
				}
				catch (ex) {
					Debug.log("examine", ex);
					// continue
				}
			}

			if (this.isInfoGetter) {
				Debug.logString("Infogetter");
				let ext = d.fileName.getExtension();
				if (ext && ext.match(/^meta(?:4|link)$/i)) {
					d.isMetalink = true;
					d.resumable = false;
				}				
				
				// Checks for available disk space.
				let tsd = d.totalSize;
				if (tsd && !d.checkSpace(tsd)) {
					return;
				}
				
				if (!d.totalSize) {
					d.resumable = false;					
					this.cantCount = true;
				}
				
				if (!d.resumable) {
					d.maxChunks = 1;
				}
				c.end = d.totalSize - 1;
				delete this.isInfoGetter;
				
				// Explicitly trigger rebuildDestination here, as we might have received
				// a html content type and need to rewrite the file
				d.rebuildDestination();
				d.resolveConflicts();
			}
			
			if (d.resumable && !d.is(CANCELED)) {
				d.resumeDownload();
			}
		}
		catch (ex) {
			Debug.log("onStartRequest", ex);
			d.fail(_("unknownerror"), _('unknownerrortext'), _("unknownerror"));
			return;
		}
	},
	onStopRequest: function DL_onStopRequest(aRequest, aContext, aStatusCode) {
		try {
			Debug.logString('StopRequest');
		}
		catch (ex) {
			return;
		}
		
		// shortcuts
		let c = this.c;
		let d = this.d;
		c.close();
		
		if (d.chunks.indexOf(c) == -1) {
			return;
		}

		// update flags and counters
		d.refreshPartialSize();
		--d.activeChunks;

		// check if we're complete now
		if (d.is(RUNNING) && d.chunks.every(function(e) { return e.complete; })) {
			if (!d.resumeDownload()) {
				d.state = FINISHING;
				Debug.logString(d + ": Download is complete!");
				d.finishDownload();
				return;
			}
		}
		
		if (c.starter && -1 != [
			NS_ERROR_CONNECTION_REFUSED,
			NS_ERROR_UNKNOWN_HOST,
			NS_ERROR_NET_TIMEOUT,
			NS_ERROR_NET_RESET
		].indexOf(aStatusCode)) {
			if (!d.urlManager.markBad(this.url)) {
				Debug.log(d + ": Server error or disconnection", "(type 3)");
				d.pauseAndRetry();
				d.status = _("servererror");
			}
			else {
				Debug.log("caught bad server", d.toString());
				d.cancel();
				d.safeRetry();
			}
			return;			
		}
		
		// work-around for ftp crap
		// nsiftpchan for some reason assumes that if RETR fails it is a directory
		// and tries to advance into said directory
		if (aStatusCode == NS_ERROR_FTP_CWD) {
			Debug.logString("Cannot change to directory :p", aStatusCode);
			if (!this.handleError()) {
				d.fail(_('servererror'), _('ftperrortext'), _('servererror'));
			}
			return;
		}
			
		// routine for normal chunk
		Debug.logString(this.url + ": Chunk " + c.start + "-" + c.end + " finished.");
		
		// rude way to determine disconnection: if connection is closed before
		// download is started we assume a server error/disconnection
		if (c.starter && d.is(RUNNING)) {
			if (!d.urlManager.markBad(this.url)) {
				Debug.log(d + ": Server error or disconnection", "(type 2)");
				d.pauseAndRetry();
				d.status = _("servererror");
			}
			else {
				Debug.log("caught bad server", d.toString());
				d.cancel();
				d.safeRetry();
			}
			return;			
		}
		
		// Server did not return any data.
		// Try to mark the URL bad
		// else pause + autoretry
		if (!c.written  && !!c.remainder) {
			if (!d.urlManager.markBad(this.url)) {
				Debug.log(d + ": Server error or disconnection", "(type 1)");
				d.pauseAndRetry();
				d.status = _("servererror");
			}
			return;
		}

		if (!d.isOf(PAUSED, CANCELED, FINISHING) && d.chunks.length == 1 && d.chunks[0] == c) {
			if (d.resumable || Preferences.getExt('resumeonerror', false)) {
				d.pauseAndRetry();
				d.status = _('errmismatchtitle');
			}
			else {
				d.fail(
					_('errmismatchtitle'),
					_('errmismatchtext', [d.partialSize, d.totalSize]),
					_('errmismatchtitle')
				);
			}
			return;			
		}
		if (!d.isOf(PAUSED, CANCELED)) {
			d.resumeDownload();
		}
	},

	// nsIProgressEventSink
  onProgress: function DL_onProgress(aRequest, aContext, aProgress, aProgressMax) {
		try {
			// shortcuts
			let c = this.c;
			let d = this.d;
			
			if (this.reexamine) {
				Debug.logString(d + ": reexamine");
				this.onStartRequest(aRequest, aContext);
				if (this.reexamine) {
					return;
				}
			}

			if (d.is(RUNNING)) {
				if (!this.resumable && d.totalSize) {
					// basic integrity check
					if (d.partialSize > d.totalSize) {
						d.dumpScoreboard();
						Debug.logString(d + ": partialSize > totalSize" + "(" + d.partialSize + "/" + d.totalSize + "/" + ( d.partialSize - d.totalSize) + ")");
						d.fail(
							_('errmismatchtitle'),
							_('errmismatchtext', [d.partialSize, d.totalSize]),
							_('errmismatchtitle')
						);
						return;
					}
				}
				else {
					d.status = _("downloading");
				}
			}
		}
		catch(ex) {
			Debug.log("onProgressChange():", ex);
		}
	},
	onStatus: function  DL_onStatus(aRequest, aContext, aStatus, aStatusArg) {}
};
const GlobalBucket = new ByteBucket(Preferences.getExt('speedlimit', -1), 1.3);